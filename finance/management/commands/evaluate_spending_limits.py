import logging

from django.core.management.base import BaseCommand
from django.urls import reverse
from django.utils import timezone, translation
from django.utils.translation import gettext
from django.utils.translation import gettext_lazy as _

from django_apps.models import user_language
from finance.models import LimitEvaluation, TransactionLimit
from finance.services.limits import (
    ALERT_FIELD_BY_THRESHOLD,
    limit_windows,
    spent_in_window,
)
from finance.services.money import fmt_money
from finance.services.push import ALERT_REPEAT_AFTER, send_limit_alert

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        'Evaluate active outgoing-spending limits; log '
        'and push-notify when a 7-day, 30-day or monthly limit is '
        'exceeded. Exceeded windows re-notify every '
        'ALERT_REPEAT_AFTER (~daily) until back under the '
        'threshold. Each run also records one LimitEvaluation row '
        'per monthly limit per month.'
    )

    def handle(self, *args, **options):
        now = timezone.now()
        today = now.date()
        limits = TransactionLimit.objects.filter(
            is_active=True
        ).select_related('user', 'category').prefetch_related(
            'accounts'
        )

        alerts = 0
        for limit in limits:
            due_alerts = []
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
                    accounts = list(limit.accounts.all())
                    alerts += 1
                    logger.warning(
                        'SPENDING_LIMIT_EXCEEDED user=%s accounts=%s '
                        'category=%s window=%s spent=%s limit=%s '
                        'currency=%s',
                        limit.user.username,
                        ','.join(a.account_id for a in accounts),
                        (
                            limit.category.name
                            if limit.category else '*'
                        ),
                        window.label,
                        spent,
                        window.threshold,
                        accounts[0].currency if accounts else '',
                    )
                    last_alerted = getattr(limit, alert_field)
                    if (
                        last_alerted is None
                        or now - last_alerted >= ALERT_REPEAT_AFTER
                    ):
                        # Fresh breach, or still exceeded past the
                        # repeat cooldown — (re-)notify.
                        due_alerts.append(
                            (window, spent, alert_field)
                        )
                elif getattr(limit, alert_field) is not None:
                    # Back under the threshold: clear the flag so the
                    # next breach notifies again.
                    setattr(limit, alert_field, None)
                    dirty.add(alert_field)

            if due_alerts:
                for _window, _spent, alert_field in due_alerts:
                    setattr(limit, alert_field, now)
                dirty.update(b[2] for b in due_alerts)
                self._send_alert(limit, due_alerts)
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
        # Rendered in the recipient's language — gettext_lazy values
        # resolve to str() inside the translation.override block.
        period_text = {
            'days7': _('the last 7 days'),
            'days30': _('the last 30 days'),
            'thisMonth': _('this month'),
        }
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
            lines = [
                gettext(
                    '{scope} on {account}: {spent} of {threshold} '
                    'in {period}'
                ).format(
                    scope=scope,
                    account=account,
                    spent=fmt_money(spent, currency),
                    threshold=fmt_money(window.threshold, currency),
                    period=period_text[window.key],
                )
                for window, spent, _alert_field in breaches
            ]
            send_limit_alert(
                limit.user,
                gettext('Spending limit exceeded'),
                '\n'.join(lines),
                reverse('finance:limits'),
            )
