import logging

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import Http404
from django.shortcuts import get_object_or_404, redirect

from django_apps.views import react_app
from finance.models import Account, Requisition, UserAccountPreference
from finance.services.gocardless import GoCardlessClient, GoCardlessError
from finance.services.rules import apply_rules

logger = logging.getLogger('django')


@login_required
def finance_app(request, subpath=''):
    """Serve the finance SPA shell for every /finance/* page.

    Re-runs ``apply_rules`` for the caller on each page load so
    categorization is enforced on visit — before the SPA's API
    calls read categories. Non-GET requests 404 like
    ``react_app``; a rules failure is logged but never blocks the
    page.
    """
    if request.method not in ('GET', 'HEAD'):
        raise Http404
    try:
        apply_rules(request.user)
    except Exception:
        logger.exception(
            'apply_rules failed for user %s', request.user.pk
        )
    return react_app(
        request, entry='finance', title='Finance', subpath=subpath
    )


@login_required
def requisition_callback(request):
    """Handle the redirect back from the bank after consent.

    Stays a Django view forever: ``/finance/callback/`` is the
    ``redirect_url`` baked into GoCardless requisitions — it reads
    the session, creates accounts, then redirects to the SPA's
    ``/finance/accounts/`` page. Every other page under
    ``/finance/`` is the React SPA shell (see ``finance/urls.py``);
    all reads/mutations live in ``finance/api.py``
    (``/api/finance/``).
    """
    requisition_id = request.session.get('requisition_id')
    if not requisition_id:
        messages.error(request, 'No pending bank connection found.')
        return redirect('finance:connect')

    requisition = get_object_or_404(
        Requisition,
        requisition_id=requisition_id,
        user=request.user,
    )

    client = GoCardlessClient()
    try:
        data = client.get_requisition_data(requisition_id)
    except GoCardlessError as exc:
        messages.error(request, f'Could not verify bank link: {exc}')
        return redirect('finance:connect')

    requisition.status = data.get('status', requisition.status)
    requisition.save(update_fields=['status', 'updated_at'])

    if requisition.status != 'LN':
        messages.warning(
            request,
            f'Bank link not complete (status: {requisition.status}).'
        )
        return redirect('finance:connect')

    for account_id in data.get('accounts', []):
        account = Account.objects.filter(
            account_id=account_id
        ).first()
        if account is None:
            try:
                details = client.get_account_details(account_id)
            except GoCardlessError:
                details = {}
            account = _link_account(
                request.user, requisition, account_id, details
            )
        UserAccountPreference.objects.get_or_create(
            user=request.user, account=account
        )

    request.session.pop('requisition_id', None)
    messages.success(request, 'Bank account connected.')
    return redirect('finance:accounts')


def _link_account(user, requisition, account_id, details):
    """Return the ``Account`` row for a GoCardless ``account_id``
    the user has not seen before — either an existing row
    reattached by IBAN, or a new one.

    GoCardless account ids are requisition-scoped, so a relink
    always returns NEW ids. When exactly one same-owner,
    same-institution ``Account`` under a dead (non-LN) requisition
    shares the IBAN, that row is reattached in place — its pk,
    transactions, category assignments, shares, limits, alerts
    and preferences survive. Zero or ambiguous matches (and
    missing IBANs) fall through to creating a new row.
    """
    # Stored IBANs predate normalization — compare both sides
    # normalized (spaces stripped, uppercased) and store the
    # normalized form.
    iban = (details.get('iban') or '').replace(' ', '').upper()
    if iban:
        candidates = [
            account
            for account in Account.objects.filter(
                owner=user,
                institution_id=requisition.institution_id,
            ).exclude(requisition__status='LN')
            if (account.iban or '').replace(' ', '').upper() == iban
        ]
        if len(candidates) == 1:
            account = candidates[0]
            logger.info(
                'Reattaching account pk %s to new account_id %s '
                '(IBAN %s match under requisition %s)',
                account.pk, account_id, iban,
                requisition.requisition_id,
            )
            account.account_id = account_id
            account.requisition = requisition
            account.name = details.get('name') or account.name
            # 'XXX' = the bank supplied no real currency — keep
            # the stored one rather than downgrading it.
            currency = details.get('currency')
            if currency and currency != 'XXX':
                account.currency = currency
            account.save()
            return account
        if candidates:
            logger.warning(
                'Ambiguous IBAN %s — %d dead-requisition accounts '
                'match; creating a new account row instead',
                iban, len(candidates),
            )
    currency = details.get('currency')
    return Account.objects.create(
        account_id=account_id,
        requisition=requisition,
        owner=user,
        institution_id=requisition.institution_id,
        iban=iban or None,
        name=details.get('name', ''),
        # GoCardless reports ISO 4217 'XXX' when the bank does not
        # supply a currency — treat it like a missing key.
        currency=(
            currency if currency and currency != 'XXX' else 'EUR'
        ),
    )
