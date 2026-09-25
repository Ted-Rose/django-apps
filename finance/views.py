import json
import logging
import uuid
from datetime import datetime, timedelta
from urllib.parse import urlencode

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST

from finance.forms import (
    CategoryRuleForm,
    RequisitionForm,
    ShareAccountForm,
    TransactionLimitForm,
)
from finance.models import (
    Account,
    AccountShare,
    Category,
    CategoryRule,
    PushSubscription,
    Requisition,
    Transaction,
    UserAccountPreference,
)
from finance.services.categories import (
    annotate_effective_category,
    annotate_effective_category_name,
)
from finance.services.gocardless import GoCardlessClient, GoCardlessError
from finance.services.rules import apply_rules, preview_rule
from finance.services.sync import sync_account_transactions

logger = logging.getLogger('django')


def _burger_menu_items(request):
    return [
        {'label': 'Home', 'url': '/', 'icon': 'house',
         'btn_class': 'btn-light'},
        {'label': 'Connect Bank', 'url': reverse('finance:connect'),
         'icon': 'bank', 'btn_class': 'btn-light'},
        {'label': 'Accounts', 'url': reverse('finance:accounts'),
         'icon': 'wallet2', 'btn_class': 'btn-light'},
        {'label': 'Transactions',
         'url': reverse('finance:transactions'),
         'icon': 'arrow-left-right', 'btn_class': 'btn-light'},
        {'label': 'Categories',
         'url': reverse('finance:categories'),
         'icon': 'pie-chart', 'btn_class': 'btn-light'},
        {'label': 'Balances', 'url': reverse('finance:balances'),
         'icon': 'cash-coin', 'btn_class': 'btn-light'},
        {'label': 'Limits', 'url': reverse('finance:limits'),
         'icon': 'speedometer2', 'btn_class': 'btn-light'},
        {'label': 'Rules', 'url': reverse('finance:rules'),
         'icon': 'funnel', 'btn_class': 'btn-light'},
        {'label': (
            f'Logout ({request.user.email or request.user.username})'
        ), 'url': '/admin/logout/', 'icon': 'box-arrow-right',
         'btn_class': 'btn-outline-light'},
    ]


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
        country = request.GET.get('country', '').strip()
        if country:
            try:
                institutions = client.list_institutions(country)
            except GoCardlessError as exc:
                messages.error(
                    request, f'Could not load institutions: {exc}'
                )

    return render(request, 'finance/connect_bank.html', {
        'form': form,
        'institutions': institutions,
        'burger_menu_items': _burger_menu_items(request),
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
        'burger_menu_items': _burger_menu_items(request),
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


TRANSACTION_SORTS = {
    'date': 'booking_date',
    'account': 'account__name',
    'description': 'remittance_information',
    'creditor': 'counterparty',
    'category': 'effective_category_name',
    'amount': 'amount',
}


def _int_or_none(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@login_required
def transaction_list(request):
    user = request.user
    transactions = annotate_effective_category(
        Transaction.objects.for_user(user).select_related('account'),
        user,
    )

    account_id = _int_or_none(request.GET.get('account'))
    if account_id is not None:
        transactions = transactions.filter(account_id=account_id)

    category_id = request.GET.get('category') or ''
    if category_id != 'none' and _int_or_none(category_id) is None:
        category_id = ''
    if category_id == 'none':
        transactions = transactions.filter(
            effective_category_id__isnull=True
        )
    elif category_id:
        transactions = transactions.filter(
            effective_category_id=category_id
        )

    creditor = (request.GET.get('creditor') or '').strip()
    search_query = (request.GET.get('q') or '').strip()
    sort = request.GET.get('sort', 'date')
    if sort not in TRANSACTION_SORTS:
        sort = 'date'
    direction = request.GET.get('direction')
    if direction not in ('asc', 'desc'):
        direction = 'desc'

    if creditor or sort == 'creditor':
        # Counterparty is the creditor for outgoing payments, the
        # debtor for incoming ones.
        transactions = transactions.annotate(
            counterparty=Coalesce('creditor_name', 'debtor_name')
        )
        if creditor:
            transactions = transactions.filter(counterparty=creditor)
    if search_query:
        transactions = transactions.filter(
            remittance_information__icontains=search_query
        )
    if sort == 'category':
        transactions = annotate_effective_category_name(
            transactions, user
        )
    field = TRANSACTION_SORTS[sort]
    ordering = field if direction == 'asc' else f'-{field}'
    transactions = transactions.order_by(ordering, '-pk')

    params = {}
    if account_id is not None:
        params['account'] = account_id
    if category_id:
        params['category'] = category_id
    if creditor:
        params['creditor'] = creditor
    if search_query:
        params['q'] = search_query
    if sort != 'date' or direction != 'desc':
        params['sort'] = sort
        params['direction'] = direction

    def page_url(**overrides):
        merged = {**params, **overrides}
        query = urlencode(
            {k: v for k, v in merged.items() if v not in (None, '')}
        )
        base = reverse('finance:transactions')
        return f'{base}?{query}' if query else base

    sort_links = {
        key: {
            'asc': page_url(sort=key, direction='asc'),
            'desc': page_url(sort=key, direction='desc'),
        }
        for key in TRANSACTION_SORTS
    }
    account_options = [
        {
            'label': str(account),
            'url': page_url(account=account.pk),
            'selected': account_id == account.pk,
        }
        for account in Account.objects.for_user(user)
    ]
    categories = list(Category.objects.filter(user=user))
    category_by_id = {cat.pk: cat for cat in categories}
    category_options = [
        {
            'name': category.name,
            'url': page_url(category=category.pk),
            'selected': category_id == str(category.pk),
        }
        for category in categories
    ]
    counterparties = (
        Transaction.objects.for_user(user)
        .annotate(name=Coalesce('creditor_name', 'debtor_name'))
        .exclude(name__isnull=True)
        .exclude(name='')
        .values_list('name', flat=True)
        .distinct()
        .order_by('name')
    )
    creditor_options = [
        {
            'name': name,
            'url': page_url(creditor=name),
            'selected': creditor == name,
        }
        for name in counterparties
    ]

    for tx in transactions:
        tx.effective_category = category_by_id.get(
            tx.effective_category_id
        )

    return render(request, 'finance/transactions.html', {
        'transactions': transactions,
        'sort': sort,
        'direction': direction,
        'descending': direction == 'desc',
        'sort_links': sort_links,
        'selected_account': account_id,
        'account_options': account_options,
        'all_accounts_url': page_url(account=None),
        'selected_creditor': creditor,
        'creditor_options': creditor_options,
        'all_creditors_url': page_url(creditor=None),
        'selected_category': category_id,
        'category_options': category_options,
        'all_categories_url': page_url(category=None),
        'uncategorized_url': page_url(category='none'),
        'search_query': search_query,
        'search_params': {
            key: value for key, value in params.items()
            if key != 'q'
        },
        'filters_active': bool(
            account_id is not None
            or category_id
            or creditor
            or search_query
        ),
        'burger_menu_items': _burger_menu_items(request),
    })


def _parse_date(value):
    try:
        return datetime.strptime(value or '', '%Y-%m-%d').date()
    except ValueError:
        return None


@login_required
def category_overview(request):
    """Per-category spending totals over a selectable time window."""
    transactions = annotate_effective_category(
        Transaction.objects.for_user(request.user), request.user
    )

    today = timezone.localdate()
    date_from = _parse_date(request.GET.get('from'))
    date_to = _parse_date(request.GET.get('to'))
    if date_from:
        transactions = transactions.filter(
            booking_date__gte=date_from
        )
    if date_to:
        transactions = transactions.filter(booking_date__lte=date_to)

    account_id = request.GET.get('account')
    if account_id:
        transactions = transactions.filter(account_id=account_id)

    grouped = (
        transactions
        .values('effective_category_id', 'currency')
        .annotate(
            spent=Sum('amount', filter=Q(amount__lt=0)),
            received=Sum('amount', filter=Q(amount__gt=0)),
            tx_count=Count('pk'),
        )
        # Clear Meta.ordering — otherwise 'booking_date' leaks into
        # GROUP BY (required by SELECT DISTINCT) and splits the
        # per-category aggregates.
        .order_by()
    )
    category_by_id = {
        category.pk: category
        for category in Category.objects.filter(user=request.user)
    }
    rows = []
    totals = {}
    for row in grouped:
        currency = row['currency']
        row['spent'] = -(row['spent'] or 0)
        row['received'] = row['received'] or 0
        row['net'] = row['received'] - row['spent']
        category = category_by_id.get(
            row.pop('effective_category_id')
        )
        row['category_name'] = (
            category.name if category else 'Uncategorized'
        )
        row['category_color'] = (
            category.color if category and category.color
            else '#6c757d'
        )
        rows.append(row)
        total = totals.setdefault(
            currency, {'spent': 0, 'received': 0}
        )
        total['spent'] += row['spent']
        total['received'] += row['received']
    rows.sort(key=lambda row: row['spent'], reverse=True)
    for row in rows:
        total = totals[row['currency']]['spent']
        row['share'] = row['spent'] / total * 100 if total else 0

    month_start = today.replace(day=1)
    prev_month_end = month_start - timedelta(days=1)
    prev_month_start = prev_month_end.replace(day=1)
    presets = [
        ('Last 7 days', today - timedelta(days=6), today),
        ('Last 30 days', today - timedelta(days=29), today),
        ('Last 90 days', today - timedelta(days=89), today),
        ('Last 365 days', today - timedelta(days=364), today),
        ('This month', month_start, today),
        ('Last month', prev_month_start, prev_month_end),
        ('All time', None, None),
    ]
    current = (date_from, date_to)
    periods = [
        {
            'label': label,
            'from': start.isoformat() if start else '',
            'to': end.isoformat() if end else '',
            'active': (start, end) == current,
        }
        for label, start, end in presets
    ]

    return render(request, 'finance/category_overview.html', {
        'rows': rows,
        'totals': totals,
        'periods': periods,
        'date_from': date_from.isoformat() if date_from else '',
        'date_to': date_to.isoformat() if date_to else '',
        'accounts': Account.objects.for_user(request.user),
        'selected_account': account_id,
        'burger_menu_items': _burger_menu_items(request),
    })


@login_required
@require_POST
def sync_transactions(request):
    """Fetch latest transactions for the user's linked accounts."""
    accounts = Account.objects.for_user(request.user).filter(
        requisition__status='LN'
    )
    if not accounts.exists():
        messages.warning(request, 'No linked bank accounts to sync.')
        return redirect('finance:transactions')

    client = GoCardlessClient()
    created = updated = failed = 0
    for account in accounts:
        try:
            c, u = sync_account_transactions(client, account)
            created += c
            updated += u
        except Exception as exc:
            failed += 1
            logger.exception(
                'Transaction sync failed for account %s: %s',
                account.account_id, exc,
            )

    if failed:
        messages.warning(
            request,
            f'Synced {created} new transactions, but '
            f'{failed} account(s) failed.',
        )
    else:
        messages.success(
            request,
            f'Synced {created} new transactions '
            f'({updated} updated).',
        )

    url = reverse('finance:transactions')
    account_id = request.POST.get('account')
    if account_id:
        url += f'?account={account_id}'
    return redirect(url)


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
    return render(request, 'finance/balances.html', {
        'rows': rows,
        'burger_menu_items': _burger_menu_items(request),
    })


@login_required
def limits_view(request):
    if request.method == 'POST':
        form = TransactionLimitForm(request.POST, user=request.user)
        if form.is_valid():
            TransactionLimit = form._meta.model
            TransactionLimit.objects.update_or_create(
                account=form.cleaned_data['account'],
                user=request.user,
                category=form.cleaned_data['category'],
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

    vapid_public_key = getattr(settings, 'VAPID_PUBLIC_KEY', '')
    return render(request, 'finance/limits.html', {
        'form': form,
        'limits': request.user.transactionlimit_set.select_related(
            'account', 'category'
        ),
        'vapid_public_key': vapid_public_key,
        'push_subscription_count': (
            request.user.push_subscriptions.count()
        ),
        'push_config': {
            'vapid_public_key': vapid_public_key,
            'subscribe_url': reverse('finance:push_subscribe'),
            'unsubscribe_url': reverse('finance:push_unsubscribe'),
        },
        'burger_menu_items': _burger_menu_items(request),
    })


@login_required
def rules_view(request):
    """Rules page: categories, prioritized rules, sandbox drawer."""
    rules = CategoryRule.objects.filter(
        user=request.user
    ).select_related('category')
    rules_data = [
        {
            'id': rule.pk,
            'category_id': rule.category_id,
            'priority': rule.priority,
            'sender_receiver_pattern': rule.sender_receiver_pattern,
            'description_pattern': rule.description_pattern,
            'match_type': rule.match_type,
            'operator': rule.operator,
            'is_active': rule.is_active,
        }
        for rule in rules
    ]
    return render(request, 'finance/rules.html', {
        'rules': rules,
        'categories': Category.objects.filter(user=request.user),
        'match_types': CategoryRule.MATCH_TYPES,
        'operators': CategoryRule.OPERATORS,
        'sandbox_config': {
            'preview_url': reverse('finance:preview_rule'),
            'rules': rules_data,
        },
        'burger_menu_items': _burger_menu_items(request),
    })


def _flatten_errors(form):
    return '; '.join(
        f'{field}: {", ".join(errors)}'
        for field, errors in form.errors.items()
    )


@login_required
@require_POST
def save_rule(request):
    """Create or update a rule, then re-apply rules over history."""
    rule = None
    if request.POST.get('rule_id'):
        rule = get_object_or_404(
            CategoryRule,
            pk=request.POST['rule_id'],
            user=request.user,
        )
    form = CategoryRuleForm(
        request.POST, instance=rule, user=request.user
    )
    if form.is_valid():
        rule = form.save(commit=False)
        rule.user = request.user
        rule.save()
        changed = apply_rules(request.user)
        messages.success(
            request,
            f'Rule saved; {changed} transaction(s) recategorized.',
        )
    else:
        messages.error(
            request, f'Could not save rule: {_flatten_errors(form)}'
        )
    return redirect('finance:rules')


@login_required
@require_POST
def delete_rule(request, rule_id):
    rule = get_object_or_404(
        CategoryRule, pk=rule_id, user=request.user
    )
    rule.delete()
    changed = apply_rules(request.user)
    messages.success(
        request,
        f'Rule deleted; {changed} transaction(s) recategorized.',
    )
    return redirect('finance:rules')


@login_required
@require_POST
def move_rule(request, rule_id):
    """Move a rule up/down; renumbers all priorities to 1..n."""
    direction = request.POST.get('direction')
    rules = list(
        CategoryRule.objects.filter(user=request.user)
        .order_by('priority', 'pk')
    )
    index = next(
        (i for i, r in enumerate(rules) if r.pk == rule_id), None
    )
    if index is None:
        return redirect('finance:rules')
    swap = index - 1 if direction == 'up' else index + 1
    if 0 <= swap < len(rules):
        rules[index], rules[swap] = rules[swap], rules[index]
        for position, rule in enumerate(rules, start=1):
            if rule.priority != position:
                rule.priority = position
                rule.save(update_fields=['priority'])
        changed = apply_rules(request.user)
        messages.success(
            request,
            f'Rule moved; {changed} transaction(s) recategorized.',
        )
    return redirect('finance:rules')


@login_required
@require_POST
def apply_rules_view(request):
    """Re-run all rules over the user's transaction history."""
    changed = apply_rules(request.user)
    messages.success(
        request, f'{changed} transaction(s) recategorized.'
    )
    return redirect('finance:rules')


@login_required
@require_POST
def preview_rule_view(request):
    """JSON: dry-run a candidate rule against transaction history."""
    result = preview_rule(request.user, request.POST)
    if 'error' in result:
        return JsonResponse({'error': result['error']}, status=400)
    return JsonResponse({'success': True, **result})


def _json_body(request):
    try:
        return json.loads(request.body or b'{}'), None
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, JsonResponse(
            {'error': 'Invalid JSON body.'}, status=400
        )


@login_required
@require_POST
def push_subscribe(request):
    """JSON: register this browser's Web Push subscription."""
    if not getattr(settings, 'VAPID_PUBLIC_KEY', ''):
        return JsonResponse(
            {'error': 'Push notifications are not configured.'},
            status=400,
        )
    data, error = _json_body(request)
    if error:
        return error
    endpoint = data.get('endpoint') or ''
    keys = data.get('keys') or {}
    p256dh = keys.get('p256dh') or ''
    auth = keys.get('auth') or ''
    if (
        not endpoint.startswith('https://')
        or len(endpoint) > 500
        or not p256dh
        or not auth
    ):
        return JsonResponse(
            {'error': 'Missing or invalid subscription fields.'},
            status=400,
        )
    # Endpoint is one browser subscription; if it was registered by a
    # different user (shared browser, changed login), reassign it to
    # the current user rather than hitting the unique constraint.
    PushSubscription.objects.update_or_create(
        endpoint=endpoint,
        defaults={
            'user': request.user,
            'p256dh': p256dh,
            'auth': auth,
        },
    )
    return JsonResponse({'success': True})


@login_required
@require_POST
def push_unsubscribe(request):
    """JSON: drop this browser's Web Push subscription."""
    data, error = _json_body(request)
    if error:
        return error
    endpoint = data.get('endpoint') or ''
    deleted, _ = PushSubscription.objects.filter(
        user=request.user, endpoint=endpoint
    ).delete()
    if not deleted:
        return JsonResponse(
            {'error': 'Subscription not found.'}, status=404
        )
    return JsonResponse({'success': True})


@login_required
@require_POST
def save_category(request):
    """Create a category (or update color when the name exists)."""
    name = request.POST.get('name', '').strip()
    color = request.POST.get('color', '').strip()
    if not name:
        messages.error(request, 'Category name is required.')
    else:
        Category.objects.update_or_create(
            user=request.user,
            name=name,
            defaults={'color': color},
        )
        messages.success(request, f'Category "{name}" saved.')
    return redirect('finance:rules')


@login_required
@require_POST
def delete_category(request, category_id):
    category = get_object_or_404(
        Category, pk=category_id, user=request.user
    )
    category.delete()
    changed = apply_rules(request.user)
    messages.success(
        request,
        f'Category deleted; {changed} transaction(s) recategorized.',
    )
    return redirect('finance:rules')
