"""Spending-limit monthly window and spend sums.

Shared by the limits page (spent vs limit progress bar, monthly
history) and the ``evaluate_spending_limits`` management command
(push alerts).
"""
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db.models import Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone

from finance.models import Account, Transaction
from finance.services.categories import annotate_counted_amount


def monthly_period_start(today):
    """First day of the calendar month containing ``today``."""
    return today.replace(day=1)


def _spend_queryset(limit, respect_exclusion=True):
    """Outgoing transactions counting toward ``limit``.

    With ``respect_exclusion``, accounts the limit user excluded
    contribute nothing (the limit keeps listing them — it just
    reads 0 from them); ``evaluate_spending_limits`` passes
    ``False`` so configured alerts still track real spend.
    Accounts the limit user lost access to (a revoked
    ``AccountShare`` leaves its M2M row behind until the next
    edit) never count — like ``check_balance_alerts``, only
    accessible accounts contribute. Transactions in the limit
    user's ``is_excluded`` categories
    are dropped entirely; ``counted_amount`` then applies each
    row's per-user partial exclusion (never flips sign, so the
    amount<0 pre-filter still selects exactly the outgoing set).
    """
    transactions = (
        Transaction.objects.with_occurrence_date()
        .filter(
            account__in=limit.accounts.filter(
                pk__in=Account.objects.for_user(limit.user)
            ),
            amount__lt=0,
        )
        .exclude(
            category_assignments__user=limit.user,
            category_assignments__category__is_excluded=True,
        )
    )
    if respect_exclusion:
        transactions = transactions.exclude(
            account__user_preferences__user=limit.user,
            account__user_preferences__excluded=True,
        )
    if limit.category_id:
        transactions = transactions.filter(
            category_assignments__user=limit.user,
            category_assignments__category=limit.category,
        )
    return annotate_counted_amount(transactions, limit.user)


def spent_in_window(limit, start, end=None,
                    respect_exclusion=True):
    """Total outgoing spend (positive) in ``[start, end)``.

    Windows bound ``occurrence_date`` — the day the user spent the
    money (earlier of booking/value date), not the bank's posting
    date, so a Sep-30 card purchase booked on Oct 1 counts toward
    September.
    """
    transactions = _spend_queryset(
        limit, respect_exclusion=respect_exclusion
    ).filter(
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
    """The monthly window's spend vs threshold dict for display.

    ``as_of`` evaluates the window as of that date's calendar
    month. Defaults to today (live view). Empty when the limit
    has no monthly threshold.
    """
    if limit.limit_monthly is None:
        return []
    today = today or timezone.now().date()
    as_of = as_of or today
    period = as_of.replace(day=1)
    stat = monthly_stat(limit, period, today)
    stat['history'] = monthly_history(
        limit, before=period, today=today
    )
    return [stat]
