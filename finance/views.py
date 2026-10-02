import logging

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, redirect

from finance.models import Account, Requisition, UserAccountPreference
from finance.services.gocardless import GoCardlessClient, GoCardlessError

logger = logging.getLogger('django')


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
        account, created = Account.objects.get_or_create(
            account_id=account_id,
            defaults={
                'requisition': requisition,
                'owner': request.user,
                'institution_id': requisition.institution_id,
            },
        )
        if created:
            try:
                details = client.get_account_details(account_id)
            except GoCardlessError:
                details = {}
            account.iban = details.get('iban')
            account.name = details.get('name', '')
            # GoCardless reports ISO 4217 'XXX' when the bank does
            # not supply a currency — treat it like a missing key.
            currency = details.get('currency')
            account.currency = (
                currency if currency and currency != 'XXX' else 'EUR'
            )
            account.save()
        UserAccountPreference.objects.get_or_create(
            user=request.user, account=account
        )

    request.session.pop('requisition_id', None)
    messages.success(request, 'Bank account connected.')
    return redirect('finance:accounts')
