import json
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from django.conf import settings

BASE_URL = 'https://bankaccountdata.gocardless.com/api/v2/'
REQUEST_TIMEOUT = 30
# Re-authenticate slightly before the stated expiry.
TOKEN_EXPIRY_MARGIN_SECONDS = 60


class GoCardlessError(Exception):
    """API failure carrying the HTTP status code and response body."""

    def __init__(self, status_code, body):
        self.status_code = status_code
        self.body = body
        super().__init__(f'GoCardless API error {status_code}: {body}')

    @property
    def dead_requisition_status(self):
        """GoCardless lifecycle status the local requisition must
        take when this error means the consent is dead — ``'EX'``
        (access expired), ``'SU'`` (suspended) or ``None``.

        Requires BOTH the HTTP status and a body marker so a random
        401/409 can never kill a consent:

        - 401 whose body's ``summary``/``type`` is
          ``AccessExpiredError`` → ``'EX'``. Falls back to a literal
          substring scan of the raw body when the body is not JSON
          or the fields are absent.
        - 409 whose ``summary``/``detail`` mentions ``suspend``
          (covers "Account suspended" and "consent suspended") →
          ``'SU'``.
        """
        try:
            payload = json.loads(self.body)
            if not isinstance(payload, dict):
                payload = None
        except (TypeError, ValueError):
            payload = None
        body = payload or {}
        summary = body.get('summary')
        detail = body.get('detail')
        error_type = body.get('type')

        if self.status_code == 401:
            if (
                summary == 'AccessExpiredError'
                or error_type == 'AccessExpiredError'
            ):
                return 'EX'
            # Substring fallback: non-JSON body, or a JSON body
            # carrying neither field.
            if (
                payload is None
                or (summary is None and error_type is None)
            ) and 'AccessExpiredError' in (self.body or ''):
                return 'EX'
        elif self.status_code == 409:
            haystack = f'{summary or ""} {detail or ""}'
            if payload is not None and 'suspend' in haystack.lower():
                return 'SU'
        return None


class GoCardlessClient:
    """Minimal raw-HTTP client for the GoCardless Bank Account Data API."""

    def __init__(self, secret_id=None, secret_key=None):
        self.secret_id = (
            secret_id
            if secret_id is not None
            else settings.GOCARDLESS_SECRET_ID
        )
        self.secret_key = (
            secret_key
            if secret_key is not None
            else settings.GOCARDLESS_SECRET_KEY
        )
        self.session = requests.Session()
        self._access_token = None
        self._access_expires_at = 0.0

    def _get_token(self):
        if (
            self._access_token
            and time.time()
            < self._access_expires_at - TOKEN_EXPIRY_MARGIN_SECONDS
        ):
            return self._access_token

        response = self.session.post(
            f'{BASE_URL}token/new/',
            json={
                'secret_id': self.secret_id,
                'secret_key': self.secret_key,
            },
            timeout=REQUEST_TIMEOUT,
        )
        if not response.ok:
            raise GoCardlessError(response.status_code, response.text)

        data = response.json()
        self._access_token = data['access']
        self._access_expires_at = (
            time.time() + data.get('access_expires', 86400)
        )
        return self._access_token

    def _request(self, method, path, **kwargs):
        token = self._get_token()
        headers = kwargs.pop('headers', {})
        headers['Authorization'] = f'Bearer {token}'
        response = self.session.request(
            method,
            f'{BASE_URL}{path}',
            headers=headers,
            timeout=REQUEST_TIMEOUT,
            **kwargs,
        )
        if not response.ok:
            raise GoCardlessError(response.status_code, response.text)
        return response.json()

    def list_institutions(self, country):
        return self._request(
            'GET', 'institutions/', params={'country': country}
        )

    def create_agreement(self, institution_id,
                         max_historical_days=730,
                         access_valid_for_days=180):
        """Create an end-user agreement (max access window + history)."""
        return self._request(
            'POST',
            'agreements/enduser/',
            json={
                'institution_id': institution_id,
                'max_historical_days': str(max_historical_days),
                'access_valid_for_days': str(access_valid_for_days),
                'access_scope': ['balances', 'details', 'transactions'],
            },
        )

    def create_requisition(self, institution_id, redirect_url,
                           reference):
        agreement = self.create_agreement(institution_id)
        return self._request(
            'POST',
            'requisitions/',
            json={
                'institution_id': institution_id,
                'redirect': redirect_url,
                'reference': reference,
                'agreement': agreement['id'],
                'user_language': 'EN',
            },
        )

    def get_requisition_data(self, requisition_id):
        return self._request('GET', f'requisitions/{requisition_id}/')

    def get_account_details(self, account_id):
        data = self._request('GET', f'accounts/{account_id}/details/')
        return data.get('account', {})

    def fetch_transactions(self, account_id, date_from=None):
        params = {}
        if date_from is not None:
            params['date_from'] = date_from.isoformat()
        data = self._request(
            'GET', f'accounts/{account_id}/transactions/', params=params
        )
        return data.get('transactions', {})

    def fetch_account_balance(self, account_id):
        data = self._request('GET', f'accounts/{account_id}/balances/')
        balances = data.get('balances', [])
        if not balances:
            return None
        for balance_type in ('interimAvailable', 'interimBooked'):
            for balance in balances:
                if balance.get('balanceType') == balance_type:
                    return balance
        return balances[0]

    def fetch_balances_parallel(self, account_ids):
        """Fetch balances concurrently; per-account failures are
        captured in the result instead of raising."""
        results = {}
        if not account_ids:
            return results

        def _fetch(account_id):
            try:
                return account_id, {
                    'ok': True,
                    'rate_limited': False,
                    'balance': self.fetch_account_balance(account_id),
                    'error': None,
                    'dead_status': None,
                }
            except requests.HTTPError as exc:
                return account_id, {
                    'ok': False,
                    'rate_limited': False,
                    'balance': None,
                    'error': str(exc),
                    'dead_status': None,
                }
            except GoCardlessError as exc:
                return account_id, {
                    'ok': False,
                    'rate_limited': exc.status_code == 429,
                    'balance': None,
                    'error': str(exc),
                    'dead_status': exc.dead_requisition_status,
                }

        with ThreadPoolExecutor(
            max_workers=min(8, len(account_ids))
        ) as executor:
            for account_id, result in executor.map(
                _fetch, account_ids
            ):
                results[account_id] = result
        return results
