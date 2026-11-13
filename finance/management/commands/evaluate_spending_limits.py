import logging

from django.core.management.base import BaseCommand
from django.urls import reverse
from django.utils import timezone, translation
from django.utils.translation import gettext

from django_apps.models import user_language
from finance.models import LimitEvaluation, TransactionLimit
from finance.services.limits import (
    monthly_period_start,
    spent_in_window,
)
from finance.services.money import fmt_money
from finance.services.push import ALERT_REPEAT_AFTER, send_limit_alert

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        'Evaluate active monthly spending limits; log and '
        'push-notify when the limit is exceeded. An exceeded '
        'limit re-notifies every ALERT_REPEAT_AFTER (~daily) '
        'until back under the threshold. Each run also records '
        'one LimitEvaluation row per limit per month.'
    )

    def handle(self, *args, **options):
        now = timezone.now()
        period = monthly_period_start(now.date())
        # Threshold removed while flagged: reset the stamp so a
        # re-added threshold starts a fresh episode.
        TransactionLimit.objects.filter(
            limit_monthly__isnull=True,
            alerted_monthly_at__isnull=False,
        ).update(alerted_monthly_at=None)
        limits = TransactionLimit.objects.filter(
            is_active=True,
            limit_monthly__isnull=False,
        ).select_related('user', 'category').prefetch_related(
            'accounts'
        )

        alerts = 0
        for limit in limits:
            spent = spent_in_window(limit, period)
            self._record_evaluations(limit, spent, period)
            if spent > limit.limit_monthly:
                accounts = list(limit.accounts.all())
                alerts += 1
                logger.warning(
                    'SPENDING_LIMIT_EXCEEDED user=%s accounts=%s '
                    'category=%s spent=%s limit=%s currency=%s',
                    limit.user.username,
                    ','.join(a.account_id for a in accounts),
                    limit.category.name if limit.category else '*',
                    spent,
                    limit.limit_monthly,
                    accounts[0].currency if accounts else '',
                )
                if (
                    limit.alerted_monthly_at is None
                    or now - limit.alerted_monthly_at
                    >= ALERT_REPEAT_AFTER
                ):
                    # Fresh breach, or still exceeded past the
                    # repeat cooldown — (re-)notify.
                    limit.alerted_monthly_at = now
                    limit.save(update_fields=[
                        'alerted_monthly_at', 'updated_at',
                    ])
                    self._send_alert(limit, spent)
            elif limit.alerted_monthly_at is not None:
                # Back under the threshold: clear the flag so the
                # next breach notifies again.
                limit.alerted_monthly_at = None
                limit.save(update_fields=[
                    'alerted_monthly_at', 'updated_at',
                ])

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

    def _send_alert(self, limit, spent):
        # Rendered in the recipient's language — gettext_lazy values
        # resolve to str() inside the translation.override block.
        accounts = list(limit.accounts.all())
        account = ', '.join(
            a.name or a.iban or a.account_id for a in accounts
        )
        currency = accounts[0].currency if accounts else ''
        with translation.override(user_language(limit.user)):
            scope = (
                limit.category.name if limit.category_id
                else gettext('All spending')
            )
            body = gettext(
                '{scope} on {account}: {spent} of {threshold} '
                'this month'
            ).format(
                scope=scope,
                account=account,
                spent=fmt_money(spent, currency),
                threshold=fmt_money(limit.limit_monthly, currency),
            )
            send_limit_alert(
                limit.user,
                gettext('Spending limit exceeded'),
                body,
                reverse('finance:limits'),
            )
