import logging

from django.core.management.base import BaseCommand
from django.urls import reverse
from django.utils import timezone

from finance.models import LimitEvaluation, TransactionLimit
from finance.services.limits import (
    ALERT_FIELD_BY_THRESHOLD,
    limit_windows,
    spent_in_window,
)
from finance.services.money import fmt_money
from finance.services.push import send_limit_alert

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        'Evaluate active per-account outgoing-spending limits; log '
        'and push-notify when a 7-day, 30-day or monthly limit is '
        'exceeded. Each run also records one LimitEvaluation row '
        'per monthly limit per month.'
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
            windows = {
                w.threshold_field: w
                for w in limit_windows(limit, today)
            }
            for threshold_field, alert_field in (
                ALERT_FIELD_BY_THRESHOLD.items()
            ):
                window = windows.get(threshold_field)
                if window is None:
                    # Threshold removed while flagged: reset so a
                    # re-added threshold starts a fresh episode.
                    if getattr(limit, alert_field) is not None:
                        setattr(limit, alert_field, None)
                        dirty.add(alert_field)
                    continue

                spent = spent_in_window(limit, window.start)
                if window.threshold_field == 'limit_monthly':
                    self._record_evaluations(
                        limit, spent, window.start
                    )
                if spent > window.threshold:
                    alerts += 1
                    logger.warning(
                        'SPENDING_LIMIT_EXCEEDED user=%s account=%s '
                        'category=%s window=%s spent=%s limit=%s '
                        'currency=%s',
                        limit.user.username,
                        limit.account.account_id,
                        (
                            limit.category.name
                            if limit.category else '*'
                        ),
                        window.label,
                        spent,
                        window.threshold,
                        limit.account.currency,
                    )
                    if getattr(limit, alert_field) is None:
                        new_breaches.append(
                            (window, spent, alert_field)
                        )
                elif getattr(limit, alert_field) is not None:
                    # Back under the threshold: clear the flag so the
                    # next breach notifies again.
                    setattr(limit, alert_field, None)
                    dirty.add(alert_field)

            if new_breaches:
                now = timezone.now()
                for _, _, alert_field in new_breaches:
                    setattr(limit, alert_field, now)
                dirty.update(b[2] for b in new_breaches)
                self._send_alert(limit, new_breaches)
            if dirty:
                limit.save(
                    update_fields=sorted(dirty) + ['updated_at']
                )

        self.stdout.write(
            f'Evaluated {limits.count()} limits: {alerts} exceeded'
        )

    @staticmethod
    def _record_evaluations(limit, spent, period_start):
        """Persist one evaluation row per limit per calendar month.

        The current month's row is refreshed on every run with the
        latest figures and the current threshold. The previous
        month's row is backfilled with the full-month spend so its
        final numbers are exact once a new month starts — an existing
        row keeps its recorded threshold.
        """
        LimitEvaluation.objects.update_or_create(
            limit=limit,
            period_start=period_start,
            defaults={
                'spent': spent,
                'threshold': limit.limit_monthly,
            },
        )
        previous = (
            period_start - timezone.timedelta(days=1)
        ).replace(day=1)
        if previous == period_start:
            return
        prev_spent = spent_in_window(
            limit, previous, end=period_start
        )
        record, created = LimitEvaluation.objects.get_or_create(
            limit=limit,
            period_start=previous,
            defaults={
                'spent': prev_spent,
                'threshold': limit.limit_monthly,
            },
        )
        if not created and record.spent != prev_spent:
            record.spent = prev_spent
            record.save(
                update_fields=['spent', 'evaluated_at']
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
                f'{fmt_money(spent, currency)} of '
                f'{fmt_money(window.threshold, currency)} '
                f'in {window.period_text}'
            )
            for window, spent, _ in breaches
        ]
        send_limit_alert(
            limit.user,
            'Spending limit exceeded',
            '\n'.join(lines),
            reverse('finance:limits'),
        )
