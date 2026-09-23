import logging
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import Sum
from django.utils import timezone

from finance.models import Transaction, TransactionLimit

logger = logging.getLogger(__name__)

WINDOWS = (
    ('limit_7_days', 7),
    ('limit_30_days', 30),
)


class Command(BaseCommand):
    help = (
        'Evaluate active per-account outgoing-spending limits and log '
        'an alert when a 7- or 30-day limit is exceeded.'
    )

    def handle(self, *args, **options):
        today = timezone.now().date()
        limits = TransactionLimit.objects.filter(
            is_active=True
        ).select_related('account', 'user')

        alerts = 0
        for limit in limits:
            for field, days in WINDOWS:
                threshold = getattr(limit, field)
                if threshold is None:
                    continue

                spent = Transaction.objects.filter(
                    account=limit.account,
                    amount__lt=0,
                    booking_date__gte=(
                        today - timezone.timedelta(days=days)
                    ),
                ).aggregate(total=Sum('amount'))['total'] or Decimal(0)

                if abs(spent) > threshold:
                    alerts += 1
                    logger.warning(
                        'SPENDING_LIMIT_EXCEEDED user=%s account=%s '
                        'window=%sd spent=%s limit=%s currency=%s',
                        limit.user.username,
                        limit.account.account_id,
                        days,
                        abs(spent),
                        threshold,
                        limit.account.currency,
                    )
                    # TODO: send_mail once EMAIL_* settings are
                    # configured.

        self.stdout.write(
            f'Evaluated {limits.count()} limits: {alerts} exceeded'
        )
