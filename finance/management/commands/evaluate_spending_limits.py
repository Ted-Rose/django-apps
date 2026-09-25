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
        ).select_related('account', 'user', 'category')

        alerts = 0
        for limit in limits:
            for field, days in WINDOWS:
                threshold = getattr(limit, field)
                if threshold is None:
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
                    # TODO: send_mail once EMAIL_* settings are
                    # configured.

        self.stdout.write(
            f'Evaluated {limits.count()} limits: {alerts} exceeded'
        )
