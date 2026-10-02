"""django-ninja router for finance (mounted at /api/finance/).

Unlike google_tasks — whose JSON views the API delegates to —
finance views are form-POST + ``messages`` + redirect, so there is
nothing to delegate to: mutations are re-implemented here, reusing
the same forms (``CategoryRuleForm``, ``TransactionLimitForm``,
``ShareAccountForm`` — Django forms accept a plain dict), the same
``services/`` functions and the same ``for_user()`` scoping, so the
template UI and the SPA share identical semantics during the
strangler period.

The ``messages.success/error`` strings become the ``message`` of a
successful JSON response (or the ``detail`` of an error) for the
SPA to toast. Errors map onto the shared contract in
``django_apps/api.py``: GoCardlessError → 502, limit-edit
uniqueness conflict → 409, form/validation failures → 400.
"""
import logging
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.paginator import Paginator
from django.db import IntegrityError
from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce, TruncMonth
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Query, Router, Schema
from pydantic import Field

from django_apps.api import ApiHttpError

from finance.forms import (
    CategoryRuleForm,
    ShareAccountForm,
    TransactionLimitForm,
)
from finance.models import (
    Account,
    AccountShare,
    BalanceAlert,
    Category,
    CategoryRule,
    Notification,
    PushSubscription,
    Requisition,
    Transaction,
    TransactionLimit,
    UserAccountPreference,
    UserTransactionCategory,
)
from finance.services.categories import (
    annotate_effective_category,
    annotate_effective_category_name,
)
from finance.services.gocardless import GoCardlessClient, GoCardlessError
from finance.services.limits import limit_window_stats
from finance.services.rules import (
    active_rules_for,
    apply_rules,
    categorize_transaction,
    preview_rule,
)
from finance.services.sync import sync_account_transactions

logger = logging.getLogger('django')

router = Router()

# Ninja router paths aren't reversible by name — literal URLs for
# the push endpoints this router mounts at /api/finance/push/*.
PUSH_SUBSCRIBE_URL = '/api/finance/push/subscribe/'
PUSH_UNSUBSCRIBE_URL = '/api/finance/push/unsubscribe/'

# Sortable transaction columns → ORM field (mirrors views.py).
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


def _parse_date(value):
    try:
        return datetime.strptime(value or '', '%Y-%m-%d').date()
    except ValueError:
        return None


def _flatten_errors(form):
    return '; '.join(
        f'{field}: {", ".join(errors)}'
        for field, errors in form.errors.items()
    )


def _balance_check_accounts(user):
    """Accounts the user opted into the balance check."""
    return Account.objects.for_user(user).filter(
        user_preferences__user=user,
        user_preferences__included_in_balance_check=True,
    )


def _account_payload(request, account, pref, alert=None):
    """Dict matching AccountOut — adds is_owner/pref/alert fields
    the model doesn't carry."""
    return {
        'id': account.pk,
        'account_id': account.account_id,
        'name': account.name,
        'iban': account.iban,
        'institution_id': account.institution_id,
        'currency': account.currency,
        'display_name': str(account),
        'is_owner': account.owner_id == request.user.pk,
        'owner_username': account.owner.username,
        'included_in_balance_check': (
            pref.included_in_balance_check if pref else False
        ),
        'balance_alert': alert.threshold if alert else None,
        'last_balance': account.last_balance,
        'balance_updated_at': account.balance_updated_at,
    }


def _balance_alert_map(user, accounts):
    """The caller's BalanceAlert per account, keyed by account pk."""
    return {
        alert.account_id: alert
        for alert in BalanceAlert.objects.filter(
            user=user, account__in=accounts
        )
    }


def _push_config(user):
    return {
        'vapid_public_key': getattr(
            settings, 'VAPID_PUBLIC_KEY', ''
        ),
        'subscription_count': user.push_subscriptions.count(),
        'subscribe_url': PUSH_SUBSCRIBE_URL,
        'unsubscribe_url': PUSH_UNSUBSCRIBE_URL,
    }


def _account_options(user):
    return [
        {'id': account.pk, 'label': str(account)}
        for account in Account.objects.for_user(user)
    ]


def _choices(pairs):
    return [
        {'value': value, 'label': label} for value, label in pairs
    ]


# --- Schemas ---

class AccountRef(Schema):
    id: int
    name: str
    iban: Optional[str] = None
    currency: str


class AccountOut(Schema):
    id: int
    account_id: str
    name: str
    iban: Optional[str] = None
    institution_id: str
    currency: str
    display_name: str
    is_owner: bool
    owner_username: str
    included_in_balance_check: bool
    # The caller's low-balance alert threshold, null when unset.
    balance_alert: Optional[Decimal] = None
    last_balance: Optional[dict] = None
    balance_updated_at: Optional[datetime] = None


class PushConfigOut(Schema):
    vapid_public_key: str
    subscription_count: int
    subscribe_url: str
    unsubscribe_url: str


class AccountsOut(Schema):
    accounts: List[AccountOut]
    push_config: PushConfigOut


class InstitutionOut(Schema):
    id: str
    name: str
    bic: Optional[str] = None
    logo: Optional[str] = None


class InstitutionsOut(Schema):
    institutions: List[InstitutionOut]


class CategoryOut(Schema):
    id: int
    name: str
    color: str


class TransactionOut(Schema):
    id: int
    transaction_id: str
    booking_date: date
    account: AccountRef
    remittance_information: Optional[str] = None
    # creditor_name for outgoing payments, debtor_name for incoming.
    counterparty: Optional[str] = None
    effective_category: Optional[CategoryOut] = None
    # True when the caller's own assignment row is a manual
    # override (rules leave it alone); NULL/falsey otherwise.
    category_is_manual: Optional[bool] = None
    amount: Decimal
    currency: str

    @staticmethod
    def resolve_counterparty(obj):
        return obj.creditor_name or obj.debtor_name


class AccountOptionOut(Schema):
    id: int
    label: str


class TransactionsOut(Schema):
    """One page of transactions plus every filter-dropdown option
    list the page needs — a single endpoint per the rewrite plan."""
    transactions: List[TransactionOut]
    page: int
    num_pages: int
    count: int
    has_next: bool
    has_previous: bool
    accounts: List[AccountOptionOut]
    categories: List[CategoryOut]
    counterparties: List[str]
    selected_account: Optional[int] = None
    selected_category: str = ''
    selected_creditor: str = ''
    selected_source: str = ''
    search_query: str = ''
    sort: str
    direction: str
    filters_active: bool


class CategoryRowOut(Schema):
    category_name: str
    # 'uncategorized' for the no-category bucket — the SPA maps it
    # to the catalog string; `category_name` stays the EN fallback.
    category_key: Optional[str] = None
    category_color: str
    spent: Decimal
    received: Decimal
    net: Decimal
    share: float
    currency: str
    tx_count: int


class CurrencyTotalOut(Schema):
    spent: Decimal
    received: Decimal


class PeriodOut(Schema):
    label: str
    # Catalog key under finance:server.periods — the SPA translates
    # it; `label` stays the English fallback.
    key: str
    date_from: str
    date_to: str
    active: bool


class CategoryOverviewOut(Schema):
    rows: List[CategoryRowOut]
    totals: Dict[str, CurrencyTotalOut]
    periods: List[PeriodOut]
    date_from: str
    date_to: str
    accounts: List[AccountOptionOut]
    selected_account: str = ''


class WindowStatBase(Schema):
    label: str
    # i18n hooks: `key` picks a catalog label (server:windows.*) for
    # fixed/current-month windows; `value` is 'YYYY-MM' for history
    # months the SPA formats via fmtMonth. `label` stays English.
    key: Optional[str] = None
    value: Optional[str] = None
    spent: Decimal
    threshold: Optional[Decimal] = None
    pct: Decimal
    bar_pct: Decimal
    bar_class: str
    remaining: Decimal
    over: Optional[Decimal] = None


class WindowStatOut(WindowStatBase):
    history: List[WindowStatBase] = []


class LimitOut(Schema):
    id: int
    account: AccountRef
    category: Optional[CategoryOut] = None
    is_active: bool
    limit_7_days: Optional[Decimal] = None
    limit_30_days: Optional[Decimal] = None
    limit_monthly: Optional[Decimal] = None
    window_stats: List[WindowStatOut] = []


class MonthOptionOut(Schema):
    value: str
    label: str
    active: bool


class LimitsOut(Schema):
    limits: List[LimitOut]
    overview_months: List[MonthOptionOut]
    selected_month: Optional[str] = None
    as_of: Optional[date] = None
    # Option lists for the limit form (same querysets the Django
    # form's fields carry in the template view).
    accounts: List[AccountOptionOut]
    categories: List[CategoryOut]
    push_config: PushConfigOut


class BalancesOut(Schema):
    accounts: List[AccountOut]


class RuleOut(Schema):
    id: int
    category_id: int
    priority: int
    counterparty_scope: str
    counterparty_pattern: str
    counterparty_match_type: str
    description_pattern: str
    description_match_type: str
    description_exclusion: str
    operator: str
    is_active: bool


class ChoiceOut(Schema):
    value: str
    label: str


class RulesOut(Schema):
    rules: List[RuleOut]
    categories: List[CategoryOut]
    match_types: List[ChoiceOut]
    counterparty_scopes: List[ChoiceOut]
    operators: List[ChoiceOut]


class ConnectIn(Schema):
    institution_id: str = Field(min_length=1, max_length=100)


class ConnectOut(Schema):
    link: str
    requisition_id: str


class ShareIn(Schema):
    username: str = ''


class SyncIn(Schema):
    account: Optional[int] = None


class SyncAccountOut(Schema):
    """Per-account sync outcome — makes 'fetched but empty'
    distinguishable from 'skipped'/'failed' in the UI."""
    account: str
    status: Literal['synced', 'failed', 'skipped']
    created: int = 0
    updated: int = 0
    detail: str = ''
    # i18n hooks — `code` maps to a `server:*` catalog key the SPA
    # interpolates with `params`; `detail` stays the English fallback.
    code: Optional[str] = None
    params: Optional[Dict[str, Any]] = None


class MessageOut(Schema):
    success: bool
    message: str
    # `code`/`params` let the SPA rebuild the message in the user's
    # language; `message` stays as the English fallback.
    code: Optional[str] = None
    params: Optional[Dict[str, Any]] = None


class SuccessOut(Schema):
    success: bool


class ToggleBalanceCheckOut(Schema):
    success: bool
    message: str
    code: Optional[str] = None
    params: Optional[Dict[str, Any]] = None
    included_in_balance_check: bool


class SyncOut(MessageOut):
    created: int
    updated: int
    failed: int
    accounts: List[SyncAccountOut] = []


class RefreshOut(MessageOut):
    updated: int
    rate_limited: int
    failed: int


class RulesChangedOut(MessageOut):
    changed: int


class LimitSaveIn(Schema):
    """Mirrors the TransactionLimitForm POST; ``account``/``category``
    are resolved against per-user form querysets."""
    limit_id: Optional[int] = None
    account: Optional[int] = None
    category: Optional[int] = None
    limit_7_days: Optional[Decimal] = None
    limit_30_days: Optional[Decimal] = None
    limit_monthly: Optional[Decimal] = None
    is_active: bool = False


class RuleSaveIn(Schema):
    """Mirrors the CategoryRuleForm POST (``rule_id`` edits)."""
    rule_id: Optional[int] = None
    category: Optional[int] = None
    priority: Optional[int] = None
    counterparty_scope: str = 'any'
    counterparty_pattern: str = ''
    counterparty_match_type: str = 'contains'
    description_pattern: str = ''
    description_match_type: str = 'contains'
    description_exclusion: str = ''
    operator: str = 'AND'
    is_active: bool = False


class MoveRuleIn(Schema):
    direction: Literal['up', 'down']


class RulePreviewIn(Schema):
    rule_id: Optional[int] = None
    category_id: Optional[int] = None
    priority: int = 1
    counterparty_scope: str = 'any'
    counterparty_pattern: str = ''
    counterparty_match_type: str = 'contains'
    description_pattern: str = ''
    description_match_type: str = 'contains'
    description_exclusion: str = ''
    operator: str = 'AND'
    is_active: bool = False


class RulePreviewChangeOut(Schema):
    id: int
    booking_date: str
    account: str
    counterparty: str
    description: str
    amount: str
    currency: str
    old_category: Optional[str] = None
    new_category: Optional[str] = None


class RulePreviewOut(Schema):
    success: bool
    match_count: int
    apply_count: int
    is_active: bool
    category: str
    changes_total: int
    gains: int
    losses: int
    other_changes: int
    changes: List[RulePreviewChangeOut]


class CategorySaveIn(Schema):
    name: str = ''
    color: str = ''


class AssignCategoryIn(Schema):
    # null locks the transaction as uncategorized (is_manual row
    # with a NULL category — rules still leave it alone).
    category: Optional[int] = None


class PushKeysIn(Schema):
    p256dh: str = ''
    auth: str = ''


class PushSubscribeIn(Schema):
    endpoint: str = ''
    keys: Optional[PushKeysIn] = None


class PushUnsubscribeIn(Schema):
    endpoint: str = ''


class BalanceAlertSaveIn(Schema):
    # Negatives are legal (overdraft alerts).
    threshold: Decimal


class NotificationOut(Schema):
    id: int
    title: str
    body: str
    url: str
    created_at: datetime


class NotificationsOut(Schema):
    notifications: List[NotificationOut]


class NotificationsReadIn(Schema):
    ids: List[int]


# --- Read endpoints ---

@router.get('/accounts/', response=AccountsOut)
def account_list(request):
    accounts = Account.objects.for_user(request.user)
    prefs = {
        pref.account_id: pref
        for pref in UserAccountPreference.objects.filter(
            user=request.user, account__in=accounts
        )
    }
    alerts = _balance_alert_map(request.user, accounts)
    return {
        'accounts': [
            _account_payload(
                request, account, prefs.get(account.pk),
                alerts.get(account.pk),
            )
            for account in accounts.select_related('owner')
        ],
        'push_config': _push_config(request.user),
    }


@router.get('/institutions/', response=InstitutionsOut)
def institutions(request, country: str = ''):
    country = country.strip()
    if not country:
        return {'institutions': []}
    client = GoCardlessClient()
    try:
        data = client.list_institutions(country)
    except GoCardlessError as exc:
        raise ApiHttpError(
            502,
            f'Could not load institutions: {exc}',
            code='couldNotLoadInstitutions',
            params={'detail': str(exc)},
        )
    return {'institutions': data}


@router.get('/transactions/', response=TransactionsOut)
def transaction_list(request, account: str = '', category: str = '',
                     creditor: str = '', q: str = '',
                     source: str = '',
                     sort: str = 'date', direction: str = 'desc',
                     page: Optional[str] = None):
    user = request.user
    transactions = annotate_effective_category(
        Transaction.objects.for_user(user).select_related('account'),
        user,
    )

    account_id = _int_or_none(account)
    if account_id is not None:
        transactions = transactions.filter(account_id=account_id)

    category_id = category or ''
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

    # ?source=manual is the audit view for manual overrides; it
    # composes with the category filter (category=none + manual
    # shows manually-locked-uncategorized rows).
    if source == 'manual':
        transactions = transactions.filter(category_is_manual=True)
    else:
        source = ''

    creditor = creditor.strip()
    search_query = q.strip()
    if sort not in TRANSACTION_SORTS:
        sort = 'date'
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

    categories = list(Category.objects.filter(user=user))
    category_by_id = {cat.pk: cat for cat in categories}
    counterparties = (
        Transaction.objects.for_user(user)
        .annotate(name=Coalesce('creditor_name', 'debtor_name'))
        .exclude(name__isnull=True)
        .exclude(name='')
        .values_list('name', flat=True)
        .distinct()
        .order_by('name')
    )

    paginator = Paginator(transactions, 100)
    page_obj = paginator.get_page(page)
    for tx in page_obj:
        tx.effective_category = category_by_id.get(
            tx.effective_category_id
        )

    return {
        'transactions': page_obj.object_list,
        'page': page_obj.number,
        'num_pages': paginator.num_pages,
        'count': paginator.count,
        'has_next': page_obj.has_next(),
        'has_previous': page_obj.has_previous(),
        'accounts': _account_options(user),
        'categories': categories,
        'counterparties': list(counterparties),
        'selected_account': account_id,
        'selected_category': category_id,
        'selected_creditor': creditor,
        'selected_source': source,
        'search_query': search_query,
        'sort': sort,
        'direction': direction,
        'filters_active': bool(
            account_id is not None
            or category_id
            or creditor
            or source
            or search_query
        ),
    }


@router.get('/categories/overview/', response=CategoryOverviewOut)
def category_overview(request,
                      from_: str = Query('', alias='from'),
                      to: str = '', account: str = ''):
    """Per-category spending totals over a selectable time window."""
    transactions = annotate_effective_category(
        Transaction.objects.for_user(request.user), request.user
    )

    today = timezone.localdate()
    date_from = _parse_date(from_)
    date_to = _parse_date(to)
    if date_from:
        transactions = transactions.filter(
            booking_date__gte=date_from
        )
    if date_to:
        transactions = transactions.filter(booking_date__lte=date_to)
    if account:
        transactions = transactions.filter(account_id=account)

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
        row['category_key'] = (
            None if category else 'uncategorized'
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
        ('This month', 'thisMonth', month_start, today),
        ('Last month', 'lastMonth', prev_month_start, prev_month_end),
        ('All time', 'allTime', None, None),
    ]
    current = (date_from, date_to)
    periods = [
        {
            'label': label,
            'key': key,
            'date_from': start.isoformat() if start else '',
            'date_to': end.isoformat() if end else '',
            'active': (start, end) == current,
        }
        for label, key, start, end in presets
    ]

    return {
        'rows': rows,
        'totals': totals,
        'periods': periods,
        'date_from': date_from.isoformat() if date_from else '',
        'date_to': date_to.isoformat() if date_to else '',
        'accounts': _account_options(request.user),
        'selected_account': account,
    }


@router.get('/limits/', response=LimitsOut)
def limits(request, month: str = ''):
    user = request.user
    today = timezone.now().date()
    this_month = today.replace(day=1)
    selected_month = None
    if month:
        try:
            year, mon = (int(p) for p in month.split('-'))
            candidate = date(year, mon, 1)
            if candidate < this_month:
                selected_month = candidate
        except (ValueError, TypeError):
            pass

    # A selected month evaluates every window as of its last day.
    as_of = None
    if selected_month:
        as_of = (
            selected_month + timedelta(days=32)
        ).replace(day=1) - timedelta(days=1)

    limits = user.transactionlimit_set.select_related(
        'account', 'category'
    )
    for limit in limits:
        limit.window_stats = limit_window_stats(limit, as_of=as_of)

    month_rows = (
        Transaction.objects.for_user(user)
        .annotate(period=TruncMonth('booking_date'))
        .values_list('period', flat=True)
        .distinct()
        .order_by('-period')
    )
    overview_months = [
        {
            'value': '',
            'label': 'This month',
            'active': selected_month is None,
        }
    ]
    for period in month_rows:
        if isinstance(period, datetime):
            period = period.date()
        period = period.replace(day=1)
        if period >= this_month:
            continue
        overview_months.append({
            'value': period.strftime('%Y-%m'),
            'label': period.strftime('%B %Y'),
            'active': period == selected_month,
        })

    return {
        'limits': limits,
        'overview_months': overview_months,
        'selected_month': (
            selected_month.strftime('%Y-%m')
            if selected_month else None
        ),
        'as_of': as_of,
        'accounts': _account_options(user),
        'categories': Category.objects.filter(user=user),
        'push_config': _push_config(user),
    }


@router.get('/balances/', response=BalancesOut)
def balances(request):
    """Stored balances for accounts the user included."""
    accounts = _balance_check_accounts(request.user)
    prefs = {
        pref.account_id: pref
        for pref in UserAccountPreference.objects.filter(
            user=request.user, account__in=accounts
        )
    }
    alerts = _balance_alert_map(request.user, accounts)
    return {
        'accounts': [
            _account_payload(
                request, account, prefs.get(account.pk),
                alerts.get(account.pk),
            )
            for account in accounts.select_related('owner')
        ]
    }


@router.get('/rules/', response=RulesOut)
def rules(request):
    """Categories, prioritized rules and the choice lists the rule
    form renders as dropdowns."""
    user = request.user
    return {
        'rules': CategoryRule.objects.filter(
            user=user
        ).select_related('category'),
        'categories': Category.objects.filter(user=user),
        'match_types': _choices(CategoryRule.MATCH_TYPES),
        'counterparty_scopes': _choices(
            CategoryRule.COUNTERPARTY_SCOPES
        ),
        'operators': _choices(CategoryRule.OPERATORS),
    }


@router.get('/notifications/', response=NotificationsOut)
def notifications(request):
    """Unread in-app alerts — the SPA drains these into toasts."""
    unread = request.user.finance_notifications.filter(
        read_at__isnull=True
    )[:20]
    return {'notifications': unread}


# --- Mutation endpoints ---

@router.post('/connect/', response=ConnectOut)
def connect(request, payload: ConnectIn):
    """Create a requisition; the SPA navigates to the returned
    GoCardless link itself (fetch must never follow it)."""
    reference = str(uuid.uuid4())
    redirect_url = f'{settings.BASE_URL}/finance/callback/'
    client = GoCardlessClient()
    try:
        data = client.create_requisition(
            institution_id=payload.institution_id,
            redirect_url=redirect_url,
            reference=reference,
        )
    except GoCardlessError as exc:
        raise ApiHttpError(
            502,
            f'Could not start bank link: {exc}',
            code='couldNotStartBankLink',
            params={'detail': str(exc)},
        )
    Requisition.objects.create(
        user=request.user,
        requisition_id=data['id'],
        institution_id=payload.institution_id,
        reference=reference,
        status=data.get('status', 'CR'),
    )
    # /finance/callback/ (a Django view forever) reads this back.
    request.session['requisition_id'] = data['id']
    return {'link': data['link'], 'requisition_id': data['id']}


@router.post(
    '/accounts/{account_id}/toggle-balance-check/',
    response=ToggleBalanceCheckOut,
)
def toggle_balance_check(request, account_id: int):
    account = get_object_or_404(
        Account.objects.for_user(request.user), pk=account_id
    )
    pref, _ = UserAccountPreference.objects.get_or_create(
        user=request.user, account=account
    )
    pref.included_in_balance_check = (
        not pref.included_in_balance_check
    )
    pref.save(update_fields=['included_in_balance_check'])
    return {
        'success': True,
        'message': (
            'Account included in the balance check.'
            if pref.included_in_balance_check
            else 'Account excluded from the balance check.'
        ),
        'code': (
            'accountIncluded'
            if pref.included_in_balance_check
            else 'accountExcluded'
        ),
        'included_in_balance_check': pref.included_in_balance_check,
    }


@router.post('/accounts/{account_id}/share/', response=MessageOut)
def share_account(request, account_id: int, payload: ShareIn):
    """Owner-only: share an owned account with another user."""
    account = get_object_or_404(
        Account, pk=account_id, owner=request.user
    )
    form = ShareAccountForm(payload.model_dump())
    if not form.is_valid():
        raise ApiHttpError(
            400, 'Please provide a username.', code='provideUsername'
        )
    target = get_user_model().objects.filter(
        username=form.cleaned_data['username']
    ).first()
    if target is None or target == request.user:
        raise ApiHttpError(
            400, 'Unknown or invalid username.', code='unknownUsername'
        )
    AccountShare.objects.get_or_create(
        account=account, shared_with=target
    )
    UserAccountPreference.objects.get_or_create(
        user=target, account=account
    )
    return {
        'success': True,
        'message': f'Account shared with {target.username}.',
        'code': 'accountShared',
        'params': {'username': target.username},
    }


@router.post('/accounts/{account_id}/balance-alert/',
             response=MessageOut)
def save_balance_alert(request, account_id: int,
                       payload: BalanceAlertSaveIn):
    """Create/update the caller's low-balance alert on an account
    (owned or shared — each viewer keeps their own threshold).
    Saving resets the episode flag so the next breach alerts."""
    account = get_object_or_404(
        Account.objects.for_user(request.user), pk=account_id
    )
    BalanceAlert.objects.update_or_create(
        user=request.user,
        account=account,
        defaults={
            'threshold': payload.threshold,
            'is_active': True,
            'alerted_at': None,
        },
    )
    return {
        'success': True,
        'message': 'Balance alert saved.',
        'code': 'balanceAlertSaved',
    }


@router.post('/accounts/{account_id}/balance-alert/delete/',
             response=MessageOut)
def delete_balance_alert(request, account_id: int):
    account = get_object_or_404(
        Account.objects.for_user(request.user), pk=account_id
    )
    BalanceAlert.objects.filter(
        user=request.user, account=account
    ).delete()
    return {
        'success': True,
        'message': 'Balance alert removed.',
        'code': 'balanceAlertRemoved',
    }


@router.post('/notifications/read/', response=SuccessOut)
def mark_notifications_read(request, payload: NotificationsReadIn):
    """Stamp the caller's notifications as read (rows stay — they
    double as the breach audit trail)."""
    request.user.finance_notifications.filter(
        pk__in=payload.ids, read_at__isnull=True
    ).update(read_at=timezone.now())
    return {'success': True}


@router.post('/transactions/sync/', response=SyncOut)
def sync_transactions(request, payload: Optional[SyncIn] = None):
    """Fetch latest transactions for the user's linked accounts."""
    visible = list(
        Account.objects.for_user(request.user)
        .select_related('requisition')
    )
    accounts = [
        a for a in visible if a.requisition.status == 'LN'
    ]
    skipped = [
        {
            'account': str(a),
            'status': 'skipped',
            'created': 0,
            'updated': 0,
            'detail': (
                f'Requisition status is {a.requisition.status} '
                f'(not LN) — bank must be relinked.'
            ),
            'code': 'requisitionNotLinked',
            'params': {'status': a.requisition.status},
        }
        for a in visible
        if a.requisition.status != 'LN'
    ]
    if not accounts:
        return {
            'success': False,
            'message': 'No linked bank accounts to sync.',
            'code': 'noLinkedAccounts',
            'created': 0,
            'updated': 0,
            'failed': 0,
            'accounts': skipped,
        }

    client = GoCardlessClient()
    created = updated = failed = 0
    results = []
    for account in accounts:
        try:
            c, u = sync_account_transactions(client, account)
            created += c
            updated += u
            results.append({
                'account': str(account),
                'status': 'synced',
                'created': c,
                'updated': u,
                'detail': '',
            })
        except Exception as exc:
            failed += 1
            logger.exception(
                'Transaction sync failed for account %s: %s',
                account.account_id, exc,
            )
            results.append({
                'account': str(account),
                'status': 'failed',
                'created': 0,
                'updated': 0,
                'detail': str(exc)[:200],
                # Exception text is never translated — the code only
                # says "the account failed"; detail stays diagnostic.
                'code': 'operationFailed',
            })

    if failed:
        message = (
            f'Synced {created} new transactions, but '
            f'{failed} account(s) failed.'
        )
    else:
        message = (
            f'Synced {created} new transactions '
            f'({updated} updated).'
        )
    return {
        'success': not failed,
        'message': message,
        # The SPA composes the localized sentence from plural-aware
        # fragments keyed off these counts (see mutations.ts).
        'code': 'synced',
        'params': {
            'created': created,
            'updated': updated,
            'failed': failed,
        },
        'created': created,
        'updated': updated,
        'failed': failed,
        'accounts': results + skipped,
    }


@router.post(
    '/transactions/{tx_id}/category/', response=MessageOut
)
def assign_category(request, tx_id: int, payload: AssignCategoryIn):
    """Manually assign (or lock off) the caller's category for one
    transaction — writes an ``is_manual`` row rules never touch."""
    tx = get_object_or_404(
        Transaction.objects.for_user(request.user), pk=tx_id
    )
    category = None
    if payload.category is not None:
        category = get_object_or_404(
            Category, pk=payload.category, user=request.user
        )
    UserTransactionCategory.objects.update_or_create(
        user=request.user,
        transaction=tx,
        defaults={'category': category, 'is_manual': True},
    )
    if category is None:
        return {
            'success': True,
            'message': 'Marked as uncategorized.',
            'code': 'markedUncategorized',
        }
    return {
        'success': True,
        'message': f'Category "{category.name}" assigned.',
        'code': 'categoryAssigned',
        'params': {'name': category.name},
    }


@router.post(
    '/transactions/{tx_id}/category/clear/', response=MessageOut
)
def clear_category(request, tx_id: int):
    """Drop the manual flag and re-run the caller's rules on this
    one transaction, so the badge immediately shows what rules
    produce (``categorize_transaction`` keeps the row when a rule
    still matches, deletes it when none does)."""
    tx = get_object_or_404(
        Transaction.objects.for_user(request.user), pk=tx_id
    )
    assignment = UserTransactionCategory.objects.filter(
        user=request.user, transaction=tx
    ).first()
    if assignment is not None:
        assignment.is_manual = False
        assignment.save(update_fields=['is_manual', 'updated_at'])
    categorize_transaction(
        tx, active_rules_for(request.user), request.user, assignment
    )
    return {
        'success': True,
        'message': 'Reverted to automatic categorization.',
        'code': 'categoryReverted',
    }


@router.post('/balances/refresh/', response=RefreshOut)
def refresh_balances(request):
    """Fetch the latest balances from GoCardless on demand."""
    accounts = _balance_check_accounts(request.user)
    if not accounts.exists():
        return {
            'success': False,
            'message': (
                'No accounts are included in the balance check.'
            ),
            'code': 'noBalanceAccounts',
            'updated': 0,
            'rate_limited': 0,
            'failed': 0,
        }

    client = GoCardlessClient()
    results = client.fetch_balances_parallel(
        [a.account_id for a in accounts]
    )
    updated = rate_limited = failed = 0
    for account in accounts:
        result = results.get(account.account_id, {})
        if result.get('ok') and result.get('balance'):
            account.last_balance = result['balance']
            account.balance_updated_at = timezone.now()
            account.save(
                update_fields=['last_balance', 'balance_updated_at']
            )
            updated += 1
        elif result.get('rate_limited'):
            rate_limited += 1
        else:
            failed += 1
            logger.warning(
                'Balance fetch failed for account %s: %s',
                account.account_id, result.get('error'),
            )

    parts = []
    if updated:
        parts.append(f'Updated {updated} balance(s)')
    if rate_limited:
        parts.append(
            f'{rate_limited} hit the daily API limit — '
            'showing last stored balance'
        )
    if failed:
        parts.append(f'{failed} failed to fetch')
    return {
        'success': not failed,
        'message': '; '.join(parts) + '.',
        # The SPA joins per-outcome plural-aware clauses client-side.
        'code': 'balancesRefreshed',
        'params': {
            'updated': updated,
            'rate_limited': rate_limited,
            'failed': failed,
        },
        'updated': updated,
        'rate_limited': rate_limited,
        'failed': failed,
    }


@router.post('/limits/save/', response=MessageOut)
def save_limit(request, payload: LimitSaveIn):
    """Create (update_or_create) or edit a TransactionLimit — same
    form + messages as the template view's POST branch."""
    editing = None
    if payload.limit_id:
        editing = get_object_or_404(
            TransactionLimit,
            pk=payload.limit_id,
            user=request.user,
        )
    form = TransactionLimitForm(
        payload.model_dump(), instance=editing, user=request.user
    )
    if not form.is_valid():
        raise ApiHttpError(
            400,
            f'Could not save limit: {_flatten_errors(form)}',
            code='couldNotSaveLimit',
            params={'errors': _flatten_errors(form)},
        )
    if editing is not None:
        limit = form.save(commit=False)
        limit.user = request.user
        try:
            limit.save()
        except IntegrityError:
            raise ApiHttpError(
                409,
                'A limit already exists for this account '
                'and category.',
                code='limitConflict',
            )
        return {
            'success': True,
            'message': 'Spending limit updated.',
            'code': 'limitUpdated',
        }
    TransactionLimit.objects.update_or_create(
        account=form.cleaned_data['account'],
        user=request.user,
        category=form.cleaned_data['category'],
        defaults={
            'limit_7_days': form.cleaned_data['limit_7_days'],
            'limit_30_days': form.cleaned_data['limit_30_days'],
            'limit_monthly': form.cleaned_data['limit_monthly'],
            'is_active': form.cleaned_data['is_active'],
        },
    )
    return {
        'success': True,
        'message': 'Spending limit saved.',
        'code': 'limitSaved',
    }


@router.post('/limits/{limit_id}/delete/', response=MessageOut)
def delete_limit(request, limit_id: int):
    limit = get_object_or_404(
        TransactionLimit, pk=limit_id, user=request.user
    )
    limit.delete()
    return {
        'success': True,
        'message': 'Spending limit deleted.',
        'code': 'limitDeleted',
    }


@router.post('/rules/save/', response=RulesChangedOut)
def save_rule(request, payload: RuleSaveIn):
    """Create or update a rule, then re-apply rules over history."""
    rule = None
    if payload.rule_id:
        rule = get_object_or_404(
            CategoryRule, pk=payload.rule_id, user=request.user
        )
    form = CategoryRuleForm(
        payload.model_dump(), instance=rule, user=request.user
    )
    if not form.is_valid():
        raise ApiHttpError(
            400,
            f'Could not save rule: {_flatten_errors(form)}',
            code='couldNotSaveRule',
            params={'errors': _flatten_errors(form)},
        )
    rule = form.save(commit=False)
    rule.user = request.user
    rule.save()
    changed = apply_rules(request.user)
    return {
        'success': True,
        'message': (
            f'Rule saved; {changed} transaction(s) recategorized.'
        ),
        'code': 'ruleSaved',
        'params': {'count': changed},
        'changed': changed,
    }


@router.post('/rules/{rule_id}/delete/', response=RulesChangedOut)
def delete_rule(request, rule_id: int):
    rule = get_object_or_404(
        CategoryRule, pk=rule_id, user=request.user
    )
    rule.delete()
    changed = apply_rules(request.user)
    return {
        'success': True,
        'message': (
            f'Rule deleted; {changed} transaction(s) recategorized.'
        ),
        'code': 'ruleDeleted',
        'params': {'count': changed},
        'changed': changed,
    }


@router.post('/rules/{rule_id}/move/', response=RulesChangedOut)
def move_rule(request, rule_id: int, payload: MoveRuleIn):
    """Move a rule up/down; renumbers all priorities to 1..n."""
    # 404 rather than the view's silent redirect for a foreign or
    # missing rule id.
    get_object_or_404(
        CategoryRule, pk=rule_id, user=request.user
    )
    rules = list(
        CategoryRule.objects.filter(user=request.user)
        .order_by('priority', 'pk')
    )
    index = next(
        i for i, r in enumerate(rules) if r.pk == rule_id
    )
    swap = index - 1 if payload.direction == 'up' else index + 1
    if not 0 <= swap < len(rules):
        return {'success': True, 'message': '', 'changed': 0}
    rules[index], rules[swap] = rules[swap], rules[index]
    for position, rule in enumerate(rules, start=1):
        if rule.priority != position:
            rule.priority = position
            rule.save(update_fields=['priority'])
    changed = apply_rules(request.user)
    return {
        'success': True,
        'message': (
            f'Rule moved; {changed} transaction(s) recategorized.'
        ),
        'code': 'ruleMoved',
        'params': {'count': changed},
        'changed': changed,
    }


@router.post('/rules/apply/', response=RulesChangedOut)
def apply_rules_endpoint(request):
    """Re-run all rules over the user's transaction history."""
    changed = apply_rules(request.user)
    return {
        'success': True,
        'message': f'{changed} transaction(s) recategorized.',
        'code': 'recategorized',
        'params': {'count': changed},
        'changed': changed,
    }


@router.post('/rules/preview/', response=RulePreviewOut)
def preview_rule_endpoint(request, payload: RulePreviewIn):
    """Dry-run a candidate rule against transaction history."""
    result = preview_rule(request.user, payload.model_dump())
    if 'error' in result:
        raise ApiHttpError(
            400, result['error'], code=result.get('code')
        )
    return result


@router.post('/categories/save/', response=MessageOut)
def save_category(request, payload: CategorySaveIn):
    """Create a category (or update color when the name exists)."""
    name = payload.name.strip()
    if not name:
        raise ApiHttpError(
            400,
            'Category name is required.',
            code='categoryNameRequired',
        )
    Category.objects.update_or_create(
        user=request.user,
        name=name,
        defaults={'color': payload.color.strip()},
    )
    return {
        'success': True,
        'message': f'Category "{name}" saved.',
        'code': 'categorySaved',
        'params': {'name': name},
    }


@router.post(
    '/categories/{category_id}/delete/', response=RulesChangedOut
)
def delete_category(request, category_id: int):
    category = get_object_or_404(
        Category, pk=category_id, user=request.user
    )
    category.delete()
    changed = apply_rules(request.user)
    return {
        'success': True,
        'message': (
            f'Category deleted; {changed} transaction(s) '
            'recategorized.'
        ),
        'code': 'categoryDeleted',
        'params': {'count': changed},
        'changed': changed,
    }


@router.post('/push/subscribe/', response=SuccessOut)
def push_subscribe(request, payload: PushSubscribeIn):
    """Register this browser's Web Push subscription."""
    if not getattr(settings, 'VAPID_PUBLIC_KEY', ''):
        raise ApiHttpError(
            400,
            'Push notifications are not configured.',
            code='pushNotConfigured',
        )
    endpoint = payload.endpoint
    keys = payload.keys
    if (
        not endpoint.startswith('https://')
        or len(endpoint) > 500
        or keys is None
        or not keys.p256dh
        or not keys.auth
    ):
        raise ApiHttpError(
            400,
            'Missing or invalid subscription fields.',
            code='invalidSubscription',
        )
    # Endpoint is one browser subscription; if it was registered by a
    # different user (shared browser, changed login), reassign it to
    # the current user rather than hitting the unique constraint.
    PushSubscription.objects.update_or_create(
        endpoint=endpoint,
        defaults={
            'user': request.user,
            'p256dh': keys.p256dh,
            'auth': keys.auth,
        },
    )
    return {'success': True}


@router.post('/push/unsubscribe/', response=SuccessOut)
def push_unsubscribe(request, payload: PushUnsubscribeIn):
    """Drop this browser's Web Push subscription."""
    deleted, _ = PushSubscription.objects.filter(
        user=request.user, endpoint=payload.endpoint
    ).delete()
    if not deleted:
        raise ApiHttpError(
            404, 'Subscription not found.', code='subscriptionNotFound'
        )
    return {'success': True}
