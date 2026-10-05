"""Spending-limit time windows and spend sums.

Shared by the limits page (spent vs limit progress bars, monthly
history) and the ``evaluate_spending_limits`` management command
(push alerts).
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db.models import Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone

from finance.models import Transaction
from finance.services.categories import annotate_counted_amount

# (threshold field, alert-episode flag field, window length, label,
#  i18n key — the SPA translates `key`, `label` stays the English
#  fallback, and gettext uses `key` for the push-alert wording).
FIXED_WINDOWS = (
    ('limit_7_days', 'alerted_7d_at', 7, '7 days', 'days7'),
    ('limit_30_days', 'alerted_30d_at', 30, '30 days', 'days30'),
)

# Every threshold field paired with its alert flag, monthly included —
# used to reset stale flags when a threshold is removed.
ALERT_FIELD_BY_THRESHOLD = {
    'limit_7_days': 'alerted_7d_at',
    'limit_30_days': 'alerted_30d_at',
    'limit_monthly': 'alerted_monthly_at',
}


@dataclass
class LimitWindow:
    """One configured window of a TransactionLimit."""
    label: str            # '7 days', '30 days', 'This month'
    key: str              # 'days7', 'days30', 'thisMonth'
    threshold_field: str
    alert_field: str
    threshold: Decimal
    start: date           # window covers [start, today]
    days: int | None = None   # rolling length; None for monthly


def monthly_period_start(today):
    """First day of the calendar month containing ``today``."""
    return today.replace(day=1)


def limit_windows(limit, today=None):
    """Active windows of ``limit`` with their current period start."""
    today = today or timezone.now().date()
    windows = []
    for threshold_field, alert_field, days, label, key in FIXED_WINDOWS:
        threshold = getattr(limit, threshold_field)
        if threshold is None:
            continue
        windows.append(LimitWindow(
            label=label,
            key=key,
            threshold_field=threshold_field,
            alert_field=alert_field,
            threshold=threshold,
            start=today - timedelta(days=days),
            days=days,
        ))
    if limit.limit_monthly is not None:
        windows.append(LimitWindow(
            label='This month',
            key='thisMonth',
            threshold_field='limit_monthly',
            alert_field='alerted_monthly_at',
            threshold=limit.limit_monthly,
            start=monthly_period_start(today),
        ))
    return windows


def _spend_queryset(limit):
    """Outgoing transactions counting toward ``limit``.

    Transactions in the limit user's ``is_excluded`` categories are
    dropped entirely; ``counted_amount`` then applies each row's
    per-user partial exclusion (never flips sign, so the amount<0
    pre-filter still selects exactly the outgoing set).
    """
    transactions = (
        Transaction.objects.with_occurrence_date()
        .filter(
            account__in=limit.accounts.all(),
            amount__lt=0,
        )
        .exclude(
            category_assignments__user=limit.user,
            category_assignments__category__is_excluded=True,
        )
    )
    if limit.category_id:
        transactions = transactions.filter(
            category_assignments__user=limit.user,
            category_assignments__category=limit.category,
        )
    return annotate_counted_amount(transactions, limit.user)


def spent_in_window(limit, start, end=None):
    """Total outgoing spend (positive) in ``[start, end)``.

    Windows bound ``occurrence_date`` — the day the user spent the
    money (earlier of booking/value date), not the bank's posting
    date, so a Sep-30 card purchase booked on Oct 1 counts toward
    September.
    """
    transactions = _spend_queryset(limit).filter(
        occurrence_date__gte=start
    )
    if end is not None:
        transactions = transactions.filter(occurrence_date__lt=end)
    spent = transactions.aggregate(
        total=Sum('counted_amount')
    )['total'] or Decimal(0)
    return abs(spent)


def _stat(spent, threshold):
    """Display dict: percentage used, bar style, remaining/over."""
    if threshold:
        pct = spent / threshold * 100
    else:
        pct = Decimal(100) if spent > 0 else Decimal(0)
    remaining = (threshold or Decimal(0)) - spent
    if remaining < 0:
        bar_class = 'bg-danger'
    elif pct >= 80:
        bar_class = 'bg-warning'
    else:
        bar_class = 'bg-success'
    return {
        'spent': spent,
        'threshold': threshold,
        'pct': pct.quantize(Decimal('0.1')),
        'bar_pct': min(Decimal(100), pct).quantize(Decimal('0.1')),
        'bar_class': bar_class,
        'remaining': remaining,
        'over': -remaining if remaining < 0 else None,
    }


def _next_month(first_of_month):
    if first_of_month.month == 12:
        return date(first_of_month.year + 1, 1, 1)
    return date(first_of_month.year, first_of_month.month + 1, 1)


def monthly_stat(limit, period_start, today=None):
    """Spend vs threshold for one calendar month.

    Past months prefer the recorded ``LimitEvaluation`` (threshold at
    the time); the current month and months without a record are
    computed live against the current threshold.
    """
    today = today or timezone.now().date()
    current_start = monthly_period_start(today)
    record = None
    if period_start < current_start:
        record = limit.evaluations.filter(
            period_start=period_start
        ).first()
    if record is not None:
        spent, threshold = record.spent, record.threshold
    else:
        spent = spent_in_window(
            limit, period_start, end=_next_month(period_start)
        )
        threshold = limit.limit_monthly
    is_current = period_start == current_start
    label = (
        'This month'
        if is_current
        else period_start.strftime('%B %Y')
    )
    return {
        'label': label,
        # The SPA formats `value` (YYYY-MM) via fmtMonth; `key`
        # selects the catalog window label for the current month.
        'key': 'thisMonth' if is_current else None,
        'value': period_start.strftime('%Y-%m'),
        'date_from': period_start,
        'date_to': _next_month(period_start) - timedelta(days=1),
        **_stat(spent, threshold),
    }


def monthly_history(limit, before=None, today=None):
    """Spend vs threshold for every month before ``before``.

    ``before`` is a first-of-month date bounding the history —
    defaults to the current month. Returns a newest-first list of
    stat dicts (same shape as ``_stat`` plus a ``label``). Months
    with a persisted ``LimitEvaluation`` show recorded figures;
    older months fall back to computed spend vs current threshold.
    """
    today = today or timezone.now().date()
    boundary = before or monthly_period_start(today)
    rows = (
        _spend_queryset(limit)
        .filter(occurrence_date__lt=boundary)
        .annotate(month=TruncMonth('occurrence_date'))
        .values('month')
        .annotate(total=Sum('counted_amount'))
        .order_by('month')
    )
    totals = {}
    for row in rows:
        month = row['month']
        if isinstance(month, datetime):
            month = month.date()
        totals[month.replace(day=1)] = abs(row['total'])

    records = {
        e.period_start: e
        for e in limit.evaluations.filter(
            period_start__lt=boundary
        )
    }
    months = set(totals) | set(records)
    if not months:
        return []

    history = []
    month = min(months)
    while month < boundary:
        record = records.get(month)
        if record is not None:
            spent, threshold = record.spent, record.threshold
        else:
            spent = totals.get(month, Decimal(0))
            threshold = limit.limit_monthly
        history.append({
            'label': month.strftime('%b %Y'),
            'value': month.strftime('%Y-%m'),
            'date_from': month,
            'date_to': _next_month(month) - timedelta(days=1),
            **_stat(spent, threshold),
        })
        month = _next_month(month)
    history.reverse()
    return history


def limit_window_stats(limit, today=None, as_of=None):
    """Per-window spend vs threshold dicts for display.

    ``as_of`` evaluates every window as of that date: rolling windows
    cover the N days ending on it, the monthly window covers its
    calendar month. Defaults to today (live view).
    """
    today = today or timezone.now().date()
    as_of = as_of or today
    stats = []
    for window in limit_windows(limit, today):
        if window.threshold_field == 'limit_monthly':
            period = as_of.replace(day=1)
            stat = monthly_stat(limit, period, today)
            stat['history'] = monthly_history(
                limit, before=period, today=today
            )
        else:
            spent = spent_in_window(
                limit,
                as_of - timedelta(days=window.days),
                end=as_of + timedelta(days=1),
            )
            stat = {
                'label': window.label,
                'key': window.key,
                'date_from': as_of - timedelta(days=window.days),
                'date_to': as_of,
                **_stat(spent, window.threshold),
            }
        stats.append(stat)
    return stats
