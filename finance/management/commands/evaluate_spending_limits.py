import logging
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import Sum
from django.urls import reverse
from django.utils import timezone

from finance.models import Transaction, TransactionLimit
from finance.services.push import send_limit_alert

logger = logging.getLogger(__name__)

# (threshold field, "already alerted" flag field, window in days)
WINDOWS = (
    ('limit_7_days', 'alerted_7d_at', 7),
    ('limit_30_days', 'alerted_30d_at', 30),
)

CURRENCY_SYMBOLS = {'EUR': '€', 'USD': '$', 'GBP': '£'}


def _fmt_money(amount, currency):
    symbol = CURRENCY_SYMBOLS.get(currency)
    if symbol:
        return f'{symbol}{amount:.2f}'
    return f'{amount:.2f} {currency}'


class Command(BaseCommand):
    help = (
        'Evaluate active per-account outgoing-spending limits; log '
        'and push-notify when a 7- or 30-day limit is exceeded.'
    )

    def handle(self, *args, **options):
        today = timezone.now().date()
        limits = TransactionLimit.objects.filter(
            is_active=True
        ).select_related('account', 'user', 'category')

        alerts = 0
        for limit in limits:
            new_breaches = []
            dirty = set()
            for field, alert_field, days in WINDOWS:
                threshold = getattr(limit, field)
                if threshold is None:
                    # Threshold removed while flagged: reset so a
                    # re-added threshold starts a fresh episode.
                    if getattr(limit, alert_field) is not None:
                        setattr(limit, alert_field, None)
                        dirty.add(alert_field)
                    continue

                transactions = Transaction.objects.filter(
                    account=limit.account,
                    amount__lt=0,
                    booking_date__gte=(
                        today - timezone.timedelta(days=days)
                    ),
                )
                if limit.category_id:
                    transactions = transactions.filter(
                        category_assignments__user=limit.user,
                        category_assignments__category=limit.category,
                    )
                spent = transactions.aggregate(
                    total=Sum('amount')
                )['total'] or Decimal(0)

                if abs(spent) > threshold:
                    alerts += 1
                    logger.warning(
                        'SPENDING_LIMIT_EXCEEDED user=%s account=%s '
                        'category=%s window=%sd spent=%s limit=%s '
                        'currency=%s',
                        limit.user.username,
                        limit.account.account_id,
                        (
                            limit.category.name
                            if limit.category else '*'
                        ),
                        days,
                        abs(spent),
                        threshold,
                        limit.account.currency,
                    )
                    if getattr(limit, alert_field) is None:
                        new_breaches.append(
                            (days, abs(spent), threshold, alert_field)
                        )
                elif getattr(limit, alert_field) is not None:
                    # Back under the threshold: clear the flag so the
                    # next breach notifies again.
                    setattr(limit, alert_field, None)
                    dirty.add(alert_field)

            if new_breaches:
                now = timezone.now()
                for _, _, _, alert_field in new_breaches:
                    setattr(limit, alert_field, now)
                dirty.update(b[3] for b in new_breaches)
                self._send_alert(limit, new_breaches)
            if dirty:
                limit.save(
                    update_fields=sorted(dirty) + ['updated_at']
                )

        self.stdout.write(
            f'Evaluated {limits.count()} limits: {alerts} exceeded'
        )

    def _send_alert(self, limit, breaches):
        scope = (
            limit.category.name if limit.category_id
            else 'All spending'
        )
        account = (
            limit.account.name or limit.account.iban
            or limit.account.account_id
        )
        currency = limit.account.currency
        lines = [
            (
                f'{scope} on {account}: '
                f'{_fmt_money(spent, currency)} of '
                f'{_fmt_money(threshold, currency)} '
                f'in the last {days} days'
            )
            for days, spent, threshold, _ in breaches
        ]
        send_limit_alert(
            limit.user,
            'Spending limit exceeded',
            '\n'.join(lines),
            reverse('finance:limits'),
        )
