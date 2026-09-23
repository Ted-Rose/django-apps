import uuid

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from finance.forms import (
    RequisitionForm,
    ShareAccountForm,
    TransactionLimitForm,
)
from finance.models import (
    Account,
    AccountShare,
    Requisition,
    Transaction,
    UserAccountPreference,
)
from finance.services.gocardless import GoCardlessClient, GoCardlessError


@login_required
def connect_bank(request):
    """Pick a bank, create a requisition, redirect to the bank link."""
    client = GoCardlessClient()
    institutions = None

    if request.method == 'POST':
        form = RequisitionForm(request.POST)
        if form.is_valid():
            institution_id = form.cleaned_data['institution_id']
            reference = str(uuid.uuid4())
            redirect_url = f'{settings.BASE_URL}/finance/callback/'
            try:
                data = client.create_requisition(
                    institution_id=institution_id,
                    redirect_url=redirect_url,
                    reference=reference,
                )
            except GoCardlessError as exc:
                messages.error(
                    request, f'Could not start bank link: {exc}'
                )
            else:
                Requisition.objects.create(
                    user=request.user,
                    requisition_id=data['id'],
                    institution_id=institution_id,
                    reference=reference,
                    status=data.get('status', 'CR'),
                )
                request.session['requisition_id'] = data['id']
                return redirect(data['link'])
    else:
        form = RequisitionForm(request.GET or None)
        if form.is_valid():
            try:
                institutions = client.list_institutions(
                    form.cleaned_data['country']
                )
            except GoCardlessError as exc:
                messages.error(
                    request, f'Could not load institutions: {exc}'
                )

    return render(request, 'finance/connect_bank.html', {
        'form': form,
        'institutions': institutions,
    })


@login_required
def requisition_callback(request):
    """Handle the redirect back from the bank after consent."""
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
            account.currency = details.get('currency', 'EUR')
            account.save()
        UserAccountPreference.objects.get_or_create(
            user=request.user, account=account
        )

    request.session.pop('requisition_id', None)
    messages.success(request, 'Bank account connected.')
    return redirect('finance:accounts')


@login_required
def account_list(request):
    """List accessible accounts; share and balance-check toggles."""
    if request.method == 'POST' and 'toggle_account' in request.POST:
        account = get_object_or_404(
            Account.objects.for_user(request.user),
            pk=request.POST['toggle_account'],
        )
        pref, _ = UserAccountPreference.objects.get_or_create(
            user=request.user, account=account
        )
        pref.included_in_balance_check = (
            not pref.included_in_balance_check
        )
        pref.save(update_fields=['included_in_balance_check'])
        return redirect('finance:accounts')

    accounts = Account.objects.for_user(request.user)
    prefs = {
        pref.account_id: pref
        for pref in UserAccountPreference.objects.filter(
            user=request.user, account__in=accounts
        )
    }
    for account in accounts:
        account.pref = prefs.get(account.pk)

    return render(request, 'finance/accounts.html', {
        'accounts': accounts,
        'share_form': ShareAccountForm(),
    })


@login_required
@require_POST
def share_account(request, account_id):
    """Share an owned account with another user by username."""
    account = get_object_or_404(
        Account, pk=account_id, owner=request.user
    )
    form = ShareAccountForm(request.POST)
    if form.is_valid():
        target = get_user_model().objects.filter(
            username=form.cleaned_data['username']
        ).first()
        if target is None or target == request.user:
            messages.error(request, 'Unknown or invalid username.')
        else:
            AccountShare.objects.get_or_create(
                account=account, shared_with=target
            )
            UserAccountPreference.objects.get_or_create(
                user=target, account=account
            )
            messages.success(
                request, f'Account shared with {target.username}.'
            )
    else:
        messages.error(request, 'Please provide a username.')
    return redirect('finance:accounts')


@login_required
def transaction_list(request):
    transactions = Transaction.objects.for_user(
        request.user
    ).select_related('account')

    account_id = request.GET.get('account')
    if account_id:
        transactions = transactions.filter(account_id=account_id)

    accounts = Account.objects.for_user(request.user)
    return render(request, 'finance/transactions.html', {
        'transactions': transactions.order_by('-booking_date'),
        'accounts': accounts,
        'selected_account': account_id,
    })


@login_required
def live_balances(request):
    """Live balance check for accounts the user included."""
    accounts = Account.objects.for_user(request.user).filter(
        user_preferences__user=request.user,
        user_preferences__included_in_balance_check=True,
    )
    client = GoCardlessClient()
    results = client.fetch_balances_parallel(
        [a.account_id for a in accounts]
    )
    rows = [
        {
            'account': account,
            'result': results.get(
                account.account_id,
                {'ok': False, 'balance': None, 'error': 'no result'},
            ),
        }
        for account in accounts
    ]
    return render(request, 'finance/balances.html', {'rows': rows})


@login_required
def limits_view(request):
    if request.method == 'POST':
        form = TransactionLimitForm(request.POST, user=request.user)
        if form.is_valid():
            TransactionLimit = form._meta.model
            TransactionLimit.objects.update_or_create(
                account=form.cleaned_data['account'],
                user=request.user,
                defaults={
                    'limit_7_days': form.cleaned_data['limit_7_days'],
                    'limit_30_days': (
                        form.cleaned_data['limit_30_days']
                    ),
                    'is_active': form.cleaned_data['is_active'],
                },
            )
            messages.success(request, 'Spending limit saved.')
            return redirect('finance:limits')
    else:
        form = TransactionLimitForm(user=request.user)

    return render(request, 'finance/limits.html', {
        'form': form,
        'limits': request.user.transactionlimit_set.select_related(
            'account'
        ),
    })
