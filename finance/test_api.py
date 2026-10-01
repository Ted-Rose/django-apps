"""Coverage for the django-ninja layer at /api/finance/ (Stage 0 of
the React rewrite): session auth, CSRF, per-user isolation, error
mapping and the JSON mutation contracts — complements the template
view coverage in tests.py."""
import json
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from finance.models import (
    AccountShare,
    Category,
    CategoryRule,
    PushSubscription,
    Requisition,
    TransactionLimit,
    UserAccountPreference,
)
from finance.services.categories import effective_category_for
from finance.services.gocardless import GoCardlessError
from finance.tests import (
    make_account,
    make_assignment,
    make_category,
    make_requisition,
    make_rule,
    make_subscription,
    make_transaction,
)


class ApiTestCase(TestCase):
    API = '/api/finance'

    def post_json(self, path, payload=None):
        return self.client.post(
            f'{self.API}{path}',
            data=json.dumps(payload or {}),
            content_type='application/json',
        )


class FinanceApiAuthTests(ApiTestCase):
    """Session auth + CSRF contract shared with /api/tasks/."""

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )

    def test_get_requires_session_auth(self):
        resp = self.client.get(f'{self.API}/accounts/')
        self.assertEqual(resp.status_code, 401)
        body = resp.json()
        self.assertEqual(body['error'], 'unauthenticated')
        self.assertTrue(
            body['login_url'].startswith('/admin/login/?next=')
        )

    def test_unauthenticated_post_is_401(self):
        resp = self.client.post(
            f'{self.API}/rules/apply/',
            data='{}',
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()['error'], 'unauthenticated')

    def test_post_without_csrf_token_rejected(self):
        csrf_client = self.client.__class__(enforce_csrf_checks=True)
        csrf_client.force_login(self.user)
        resp = csrf_client.post(
            f'{self.API}/rules/apply/',
            data='{}',
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()['error'], 'forbidden')

    def test_post_with_csrf_token_allowed(self):
        csrf_client = self.client.__class__(enforce_csrf_checks=True)
        csrf_client.force_login(self.user)
        csrf_client.cookies['csrftoken'] = 'x' * 32
        resp = csrf_client.post(
            f'{self.API}/rules/apply/',
            data='{}',
            content_type='application/json',
            HTTP_X_CSRFTOKEN='x' * 32,
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])


class AccountsApiTests(ApiTestCase):
    """for_user() scoping: sharers read shared accounts but
    owner-only mutations stay owner-only."""

    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            username='alice', password='pw'
        )
        self.sharer = User.objects.create_user(
            username='bob', password='pw'
        )
        self.third = User.objects.create_user(
            username='carol', password='pw'
        )
        self.req = make_requisition(self.owner)
        self.account = make_account(self.owner, self.req)
        AccountShare.objects.create(
            account=self.account, shared_with=self.sharer
        )

    def test_sharer_reads_shared_account(self):
        self.client.force_login(self.sharer)
        resp = self.client.get(f'{self.API}/accounts/')
        self.assertEqual(resp.status_code, 200)
        accounts = resp.json()['accounts']
        self.assertEqual(len(accounts), 1)
        self.assertEqual(accounts[0]['account_id'], 'acc-1')
        self.assertFalse(accounts[0]['is_owner'])
        self.assertEqual(accounts[0]['owner_username'], 'alice')

    def test_accounts_excludes_foreign_accounts(self):
        self.client.force_login(self.third)
        resp = self.client.get(f'{self.API}/accounts/')
        self.assertEqual(resp.json()['accounts'], [])

    def test_sharer_cannot_share_onward(self):
        self.client.force_login(self.sharer)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/share/',
            {'username': 'carol'},
        )
        self.assertEqual(resp.status_code, 404)
        self.assertFalse(
            AccountShare.objects.filter(
                shared_with=self.third
            ).exists()
        )

    def test_owner_can_share(self):
        self.client.force_login(self.owner)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/share/',
            {'username': 'carol'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        self.assertEqual(
            resp.json()['message'], 'Account shared with carol.'
        )
        self.assertTrue(
            AccountShare.objects.filter(
                account=self.account, shared_with=self.third
            ).exists()
        )
        # A default preference is created for the new viewer.
        self.assertTrue(
            UserAccountPreference.objects.filter(
                user=self.third, account=self.account
            ).exists()
        )

    def test_share_unknown_username_is_400(self):
        self.client.force_login(self.owner)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/share/',
            {'username': 'nobody'},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'bad_request')
        self.assertIn('username', resp.json()['detail'])

    def test_share_self_is_400(self):
        self.client.force_login(self.owner)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/share/',
            {'username': 'alice'},
        )
        self.assertEqual(resp.status_code, 400)

    def test_sharer_toggles_own_balance_check(self):
        pref = UserAccountPreference.objects.create(
            user=self.sharer,
            account=self.account,
            included_in_balance_check=True,
        )
        self.client.force_login(self.sharer)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/toggle-balance-check/'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['included_in_balance_check'])
        pref.refresh_from_db()
        self.assertFalse(pref.included_in_balance_check)


class TransactionsApiTests(ApiTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.client.force_login(self.user)

    def test_list_returns_rows_and_option_lists(self):
        category = make_category(self.user, 'Groceries')
        tx = make_transaction(
            self.account, 't-1', '-10.00', creditor_name='Rimi'
        )
        make_assignment(self.user, tx, category)

        resp = self.client.get(f'{self.API}/transactions/')

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['count'], 1)
        self.assertEqual(body['page'], 1)
        self.assertEqual(body['num_pages'], 1)
        self.assertFalse(body['filters_active'])
        row = body['transactions'][0]
        self.assertEqual(row['transaction_id'], 't-1')
        self.assertEqual(row['counterparty'], 'Rimi')
        self.assertEqual(row['amount'], '-10.00')
        self.assertEqual(
            row['effective_category']['name'], 'Groceries'
        )
        self.assertEqual(row['account']['id'], self.account.pk)
        self.assertEqual(
            body['accounts'][0]['id'], self.account.pk
        )
        self.assertEqual(body['counterparties'], ['Rimi'])
        self.assertEqual(
            body['categories'][0]['name'], 'Groceries'
        )

    def test_filters_sort_and_search(self):
        make_transaction(
            self.account, 't-1', '-5.00', creditor_name='Rimi',
            remittance_information='groceries',
        )
        make_transaction(
            self.account, 't-2', '-50.00', creditor_name='Maxima',
            remittance_information='rent',
        )

        resp = self.client.get(
            f'{self.API}/transactions/?creditor=Rimi'
        )
        body = resp.json()
        self.assertEqual(
            [t['transaction_id'] for t in body['transactions']],
            ['t-1'],
        )
        self.assertTrue(body['filters_active'])

        resp = self.client.get(
            f'{self.API}/transactions/?q=rent&sort=amount'
            '&direction=asc'
        )
        body = resp.json()
        self.assertEqual(
            [t['transaction_id'] for t in body['transactions']],
            ['t-2'],
        )
        self.assertEqual(body['sort'], 'amount')
        self.assertEqual(body['direction'], 'asc')

        resp = self.client.get(
            f'{self.API}/transactions/?category=none'
        )
        self.assertEqual(resp.json()['count'], 2)

    def test_foreign_transactions_hidden(self):
        other = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        req = make_requisition(other, 'req-b')
        foreign = make_account(other, req, 'acc-b')
        make_transaction(foreign, 't-x', '-9.00')
        resp = self.client.get(f'{self.API}/transactions/')
        self.assertEqual(resp.json()['count'], 0)


class LimitsApiTests(ApiTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.client.force_login(self.user)

    def test_limits_get_includes_push_config(self):
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )
        resp = self.client.get(f'{self.API}/limits/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(len(body['limits']), 1)
        limit = body['limits'][0]
        self.assertEqual(limit['limit_7_days'], '100.00')
        self.assertEqual(
            limit['window_stats'][0]['label'], '7 days'
        )
        self.assertIn('history', limit['window_stats'][0] or {})
        push_config = body['push_config']
        self.assertEqual(push_config['subscription_count'], 0)
        self.assertEqual(
            push_config['subscribe_url'],
            '/api/finance/push/subscribe/',
        )
        self.assertEqual(
            push_config['unsubscribe_url'],
            '/api/finance/push/unsubscribe/',
        )
        # Option lists for the limit form ship in the same response.
        self.assertEqual(
            body['accounts'][0]['id'], self.account.pk
        )

    def test_save_limit_creates_row(self):
        resp = self.post_json('/limits/save/', {
            'account': self.account.pk,
            'limit_7_days': '100.00',
            'is_active': True,
        })
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        self.assertEqual(
            resp.json()['message'], 'Spending limit saved.'
        )
        limit = TransactionLimit.objects.get(
            account=self.account, user=self.user
        )
        self.assertEqual(limit.limit_7_days, Decimal('100.00'))

    def test_save_limit_rejects_other_users_account(self):
        other = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        foreign = make_account(other, self.req, 'acc-b')
        resp = self.post_json('/limits/save/', {
            'account': foreign.pk,
            'limit_7_days': '100.00',
        })
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(
            TransactionLimit.objects.filter(
                account=foreign
            ).exists()
        )

    def test_save_limit_edit_conflict_is_409(self):
        cat_a = make_category(self.user, 'A')
        cat_b = make_category(self.user, 'B')
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            category=cat_a,
            limit_7_days=Decimal('10.00'),
        )
        second = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            category=cat_b,
            limit_7_days=Decimal('20.00'),
        )
        # Editing `second` to collide on (account, user, category)
        # hits the unique constraint → 409.
        resp = self.post_json('/limits/save/', {
            'limit_id': second.pk,
            'account': self.account.pk,
            'category': cat_a.pk,
            'limit_7_days': '30.00',
            'is_active': True,
        })
        self.assertEqual(resp.status_code, 409)
        body = resp.json()
        self.assertEqual(body['error'], 'conflict')
        self.assertIn('already exists', body['detail'])
        # NB: the caught IntegrityError breaks the test's atomic
        # block — assert on the response only, no further queries.

    def test_delete_limit_scoped_to_user(self):
        other = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        foreign = TransactionLimit.objects.create(
            account=self.account,
            user=other,
            limit_7_days=Decimal('100.00'),
        )
        resp = self.post_json(f'/limits/{foreign.pk}/delete/')
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(
            TransactionLimit.objects.filter(pk=foreign.pk).exists()
        )


class RulesApiTests(ApiTestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.other = User.objects.create_user(
            username='bob', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.category = make_category(self.user)
        self.client.force_login(self.user)

    def rule_payload(self, **overrides):
        payload = {
            'category': self.category.pk,
            'priority': 1,
            'counterparty_scope': 'any',
            'counterparty_pattern': '',
            'counterparty_match_type': 'contains',
            'description_pattern': 'shop',
            'description_match_type': 'contains',
            'description_exclusion': '',
            'operator': 'AND',
            'is_active': True,
        }
        payload.update(overrides)
        return payload

    def test_rules_get_lists_rules_and_choices(self):
        make_rule(self.user, self.category, description='shop')
        resp = self.client.get(f'{self.API}/rules/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(len(body['rules']), 1)
        self.assertEqual(
            body['rules'][0]['description_pattern'], 'shop'
        )
        self.assertEqual(body['categories'][0]['name'], 'Groceries')
        self.assertEqual(
            body['match_types'][0],
            {'value': 'contains', 'label': 'Contains'},
        )
        self.assertEqual(
            body['operators'], [
                {'value': 'AND', 'label': 'AND'},
                {'value': 'OR', 'label': 'OR'},
            ]
        )

    def test_preview_returns_preview_dict(self):
        make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop run',
        )
        resp = self.post_json('/rules/preview/', {
            'category_id': self.category.pk,
            'priority': 1,
            'description_pattern': 'shop',
            'is_active': True,
        })
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['match_count'], 1)
        self.assertEqual(body['apply_count'], 1)
        self.assertEqual(body['changes_total'], 1)
        self.assertEqual(
            body['changes'][0]['new_category'], 'Groceries'
        )

    def test_preview_missing_category_is_400(self):
        resp = self.post_json(
            '/rules/preview/', {'description_pattern': 'shop'}
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'bad_request')

    def test_save_rule_creates_and_applies(self):
        tx = make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        resp = self.post_json('/rules/save/', self.rule_payload())
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['changed'], 1)
        self.assertIn('Rule saved', body['message'])
        self.assertEqual(
            effective_category_for(tx, self.user), self.category
        )

    def test_save_rule_form_errors_are_400(self):
        resp = self.post_json('/rules/save/', {
            'category': self.category.pk,
            'priority': 1,
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Could not save rule', resp.json()['detail'])

    def test_save_rule_scoped_to_owner(self):
        rule = make_rule(
            self.user, self.category, description='shop'
        )
        self.client.force_login(self.other)
        resp = self.post_json('/rules/save/', self.rule_payload(
            rule_id=rule.pk, description_pattern='hijack',
        ))
        self.assertEqual(resp.status_code, 404)
        rule.refresh_from_db()
        self.assertEqual(rule.description_pattern, 'shop')

    def test_move_rule_swaps_priority(self):
        other_cat = make_category(self.user, 'Other')
        first = make_rule(
            self.user, self.category, priority=1, description='a'
        )
        second = make_rule(
            self.user, other_cat, priority=2, description='b'
        )
        resp = self.post_json(
            f'/rules/{second.pk}/move/', {'direction': 'up'}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((second.priority, first.priority), (1, 2))

    def test_apply_rules_reports_changed(self):
        make_rule(self.user, self.category, description='shop')
        make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        resp = self.post_json('/rules/apply/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['changed'], 1)
        self.assertEqual(
            body['message'], '1 transaction(s) recategorized.'
        )

    def test_category_save_and_delete(self):
        resp = self.post_json('/categories/save/', {
            'name': 'Travel', 'color': '#00ff00',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.json()['message'], 'Category "Travel" saved.'
        )
        category = Category.objects.get(user=self.user, name='Travel')
        self.assertEqual(category.color, '#00ff00')

        resp = self.post_json(
            f'/categories/{category.pk}/delete/'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(
            Category.objects.filter(pk=category.pk).exists()
        )

    def test_category_save_requires_name(self):
        resp = self.post_json('/categories/save/', {'name': '  '})
        self.assertEqual(resp.status_code, 400)


class PushApiTests(ApiTestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.other = User.objects.create_user(
            username='bob', password='pw'
        )
        self.payload = {
            'endpoint': 'https://push.example.com/sub/1',
            'keys': {'p256dh': 'key', 'auth': 'secret'},
        }
        self.client.force_login(self.user)

    @override_settings(VAPID_PUBLIC_KEY='pub')
    def test_subscribe_creates_and_updates_row(self):
        resp = self.post_json('/push/subscribe/', self.payload)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        sub = PushSubscription.objects.get(user=self.user)
        self.assertEqual(sub.p256dh, 'key')

        updated = dict(self.payload)
        updated['keys'] = {'p256dh': 'key2', 'auth': 'secret2'}
        resp = self.post_json('/push/subscribe/', updated)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(PushSubscription.objects.count(), 1)
        sub.refresh_from_db()
        self.assertEqual(sub.p256dh, 'key2')

    @override_settings(VAPID_PUBLIC_KEY='pub')
    def test_subscribe_400_on_bad_endpoint(self):
        bad_endpoints = (
            'http://insecure.example.com/sub/1',
            '',
            'https://' + 'x' * 600,
        )
        for endpoint in bad_endpoints:
            resp = self.post_json('/push/subscribe/', {
                'endpoint': endpoint,
                'keys': {'p256dh': 'k', 'auth': 'a'},
            })
            self.assertEqual(resp.status_code, 400)
        self.assertFalse(PushSubscription.objects.exists())

    @override_settings(VAPID_PUBLIC_KEY='pub')
    def test_subscribe_400_on_missing_keys(self):
        resp = self.post_json('/push/subscribe/', {
            'endpoint': 'https://push.example.com/sub/1',
        })
        self.assertEqual(resp.status_code, 400)
        resp = self.post_json('/push/subscribe/', {
            'endpoint': 'https://push.example.com/sub/1',
            'keys': {},
        })
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(PushSubscription.objects.exists())

    @override_settings(VAPID_PUBLIC_KEY='')
    def test_subscribe_400_when_vapid_unconfigured(self):
        resp = self.post_json('/push/subscribe/', self.payload)
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(PushSubscription.objects.exists())

    def test_unsubscribe_deletes_own_row(self):
        sub = make_subscription(
            self.user, self.payload['endpoint']
        )
        resp = self.post_json(
            '/push/unsubscribe/', {'endpoint': sub.endpoint}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(PushSubscription.objects.exists())

    def test_unsubscribe_404_for_foreign_endpoint(self):
        sub = make_subscription(
            self.other, self.payload['endpoint']
        )
        resp = self.post_json(
            '/push/unsubscribe/', {'endpoint': sub.endpoint}
        )
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(PushSubscription.objects.exists())


class ConnectApiTests(ApiTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )
        self.client.force_login(self.user)

    def test_connect_returns_link_and_writes_session(self):
        client = MagicMock()
        client.create_requisition.return_value = {
            'id': 'req-42',
            'status': 'CR',
            'link': 'https://bank.example.com/auth',
        }
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            resp = self.post_json(
                '/connect/', {'institution_id': 'BANK'}
            )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['link'], 'https://bank.example.com/auth')
        self.assertEqual(body['requisition_id'], 'req-42')
        self.assertEqual(
            self.client.session['requisition_id'], 'req-42'
        )
        self.assertTrue(
            Requisition.objects.filter(
                requisition_id='req-42', user=self.user
            ).exists()
        )

    def test_connect_gocardless_error_is_502(self):
        client = MagicMock()
        client.create_requisition.side_effect = GoCardlessError(
            400, 'bad request'
        )
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            resp = self.post_json(
                '/connect/', {'institution_id': 'BANK'}
            )
        self.assertEqual(resp.status_code, 502)
        body = resp.json()
        self.assertEqual(body['error'], 'upstream_error')
        self.assertIn('Could not start bank link', body['detail'])

    def test_institutions_list(self):
        client = MagicMock()
        client.list_institutions.return_value = [
            {
                'id': 'BANK_LV',
                'name': 'Test Bank',
                'bic': 'BANKL22',
                'logo': 'https://example.com/logo.png',
                'countries': ['LV'],
                'transaction_total_days': '90',
            },
        ]
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            resp = self.client.get(
                f'{self.API}/institutions/?country=lv'
            )
        self.assertEqual(resp.status_code, 200)
        institutions = resp.json()['institutions']
        self.assertEqual(institutions[0]['id'], 'BANK_LV')
        self.assertEqual(institutions[0]['name'], 'Test Bank')
        client.list_institutions.assert_called_once_with('lv')

    def test_institutions_gocardless_error_is_502(self):
        client = MagicMock()
        client.list_institutions.side_effect = GoCardlessError(
            503, 'down'
        )
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            resp = self.client.get(
                f'{self.API}/institutions/?country=lv'
            )
        self.assertEqual(resp.status_code, 502)
        self.assertEqual(resp.json()['error'], 'upstream_error')

    def test_institutions_without_country_is_empty(self):
        resp = self.client.get(f'{self.API}/institutions/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['institutions'], [])


class SyncAndBalancesApiTests(ApiTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.client.force_login(self.user)

    def test_sync_without_linked_accounts(self):
        self.req.status = 'CR'
        self.req.save()
        resp = self.post_json('/transactions/sync/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertFalse(body['success'])
        self.assertEqual(
            body['message'], 'No linked bank accounts to sync.'
        )

    def test_sync_reports_counts(self):
        client = MagicMock()
        client.fetch_transactions.return_value = {
            'booked': [
                {
                    'transactionId': 'tx-1',
                    'bookingDate': '2026-09-20',
                    'transactionAmount': {
                        'amount': '-12.34', 'currency': 'EUR',
                    },
                },
            ],
        }
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            resp = self.post_json('/transactions/sync/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['created'], 1)
        self.assertEqual(body['failed'], 0)
        self.assertIn('Synced 1 new transactions', body['message'])

    def test_refresh_balances_without_included_accounts(self):
        resp = self.post_json('/balances/refresh/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertFalse(body['success'])
        self.assertIn('No accounts are included', body['message'])

    def test_refresh_balances_stores_balance(self):
        UserAccountPreference.objects.create(
            user=self.user, account=self.account
        )
        client = MagicMock()
        client.fetch_balances_parallel.return_value = {
            'acc-1': {
                'ok': True,
                'rate_limited': False,
                'balance': {
                    'balanceAmount': {
                        'amount': '123.45', 'currency': 'EUR',
                    },
                    'balanceType': 'interimAvailable',
                },
                'error': None,
            },
        }
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            resp = self.post_json('/balances/refresh/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['updated'], 1)
        self.assertIn('Updated 1 balance(s)', body['message'])
        self.account.refresh_from_db()
        self.assertEqual(
            self.account.last_balance['balanceAmount']['amount'],
            '123.45',
        )

    def test_balances_lists_included_accounts(self):
        UserAccountPreference.objects.create(
            user=self.user,
            account=self.account,
            included_in_balance_check=True,
        )
        resp = self.client.get(f'{self.API}/balances/')
        self.assertEqual(resp.status_code, 200)
        accounts = resp.json()['accounts']
        self.assertEqual(len(accounts), 1)
        self.assertTrue(accounts[0]['included_in_balance_check'])
