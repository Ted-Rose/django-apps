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

# (threshold field, alert-episode flag field, window length, label)
FIXED_WINDOWS = (
    ('limit_7_days', 'alerted_7d_at', 7, '7 days'),
    ('limit_30_days', 'alerted_30d_at', 30, '30 days'),
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
    period_text: str      # 'the last 7 days', 'this month'
    threshold_field: str
    alert_field: str
    threshold: Decimal
    start: date           # window covers [start, today]


def monthly_period_start(today):
    """First day of the calendar month containing ``today``."""
    return today.replace(day=1)


def limit_windows(limit, today=None):
    """Active windows of ``limit`` with their current period start."""
    today = today or timezone.now().date()
    windows = []
    for threshold_field, alert_field, days, label in FIXED_WINDOWS:
        threshold = getattr(limit, threshold_field)
        if threshold is None:
            continue
        windows.append(LimitWindow(
            label=label,
            period_text=f'the last {label}',
            threshold_field=threshold_field,
            alert_field=alert_field,
            threshold=threshold,
            start=today - timedelta(days=days),
        ))
    if limit.limit_monthly is not None:
        windows.append(LimitWindow(
            label='This month',
            period_text='this month',
            threshold_field='limit_monthly',
            alert_field='alerted_monthly_at',
            threshold=limit.limit_monthly,
            start=monthly_period_start(today),
        ))
    return windows


def _spend_queryset(limit):
    transactions = Transaction.objects.filter(
        account=limit.account,
        amount__lt=0,
    )
    if limit.category_id:
        transactions = transactions.filter(
            category_assignments__user=limit.user,
            category_assignments__category=limit.category,
        )
    return transactions


def spent_in_window(limit, start, end=None):
    """Total outgoing spend (positive) in ``[start, end)``."""
    transactions = _spend_queryset(limit).filter(
        booking_date__gte=start
    )
    if end is not None:
        transactions = transactions.filter(booking_date__lt=end)
    spent = transactions.aggregate(
        total=Sum('amount')
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


def monthly_history(limit, today=None):
    """Spend vs threshold for every past month, newest first.

    Months with a persisted ``LimitEvaluation`` (written by the
    ``evaluate_spending_limits`` command) show the recorded figures —
    including the threshold at the time. Months predating the first
    evaluation fall back to spend computed from transactions against
    the *current* threshold.
    """
    today = today or timezone.now().date()
    current_start = monthly_period_start(today)
    rows = (
        _spend_queryset(limit)
        .filter(booking_date__lt=current_start)
        .annotate(month=TruncMonth('booking_date'))
        .values('month')
        .annotate(total=Sum('amount'))
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
            period_start__lt=current_start
        )
    }
    months = set(totals) | set(records)
    if not months:
        return []

    history = []
    month = min(months)
    while month < current_start:
        record = records.get(month)
        if record is not None:
            spent, threshold = record.spent, record.threshold
        else:
            spent = totals.get(month, Decimal(0))
            threshold = limit.limit_monthly
        history.append({
            'label': month.strftime('%b %Y'),
            **_stat(spent, threshold),
        })
        month = _next_month(month)
    history.reverse()
    return history


def limit_window_stats(limit, today=None):
    """Per-window spend vs threshold dicts for display."""
    today = today or timezone.now().date()
    stats = []
    for window in limit_windows(limit, today):
        stat = {
            'label': window.label,
            **_stat(spent_in_window(limit, window.start),
                    window.threshold),
        }
        if window.threshold_field == 'limit_monthly':
            stat['history'] = monthly_history(limit, today)
        stats.append(stat)
    return stats
