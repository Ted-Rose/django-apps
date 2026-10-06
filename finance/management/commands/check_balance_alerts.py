import logging
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand
from django.urls import reverse
from django.utils import timezone, translation
from django.utils.translation import gettext

from django_apps.models import user_language
from finance.models import BalanceAlert, Notification
from finance.services.gocardless import GoCardlessClient
from finance.services.money import fmt_money
from finance.services.push import ALERT_REPEAT_AFTER, send_limit_alert

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        'Refresh stored balances for accounts carrying an active '
        'BalanceAlert, then push-notify (and record an in-app '
        'Notification for) each user whose balance dropped below '
        'their threshold. Alerts re-fire every ALERT_REPEAT_AFTER '
        '(~daily) while the breach persists: alerted_at is stamped '
        'on each notify and cleared once the balance recovers. '
        'Accounts whose fetch fails are skipped '
        'entirely — a stale balance must never false-alert.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help=(
                'Fetch and evaluate without writing balances, '
                'notifications or alert flags, and without pushing.'
            ),
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        alerts = list(
            BalanceAlert.objects.filter(is_active=True)
            .select_related('account', 'user')
        )
        if not alerts:
            self.stdout.write('No active balance alerts.')
            return

        # One balance fetch per distinct account even when several
        # users alert on it (shared accounts).
        accounts = {}
        for alert in alerts:
            accounts[alert.account.pk] = alert.account
        alerts_by_account = {}
        for alert in alerts:
            alerts_by_account.setdefault(
                alert.account.pk, []
            ).append(alert)

        client = GoCardlessClient()
        results = client.fetch_balances_parallel(
            [a.account_id for a in accounts.values()]
        )

        now = timezone.now()
        evaluated = triggered = 0
        for account in accounts.values():
            result = results.get(account.account_id, {})
            if not result.get('ok') or not result.get('balance'):
                logger.warning(
                    'Balance fetch failed for account %s — '
                    'skipping its alerts: %s',
                    account.account_id, result.get('error'),
                )
                continue
            balance = result['balance']
            if not dry_run:
                # Same fields POST /api/finance/balances/refresh/
                # writes — the Balances page gets daily-fresh data.
                account.last_balance = balance
                account.balance_updated_at = now
                account.save(update_fields=[
                    'last_balance', 'balance_updated_at',
                ])

            amount = self._balance_amount(balance, account)
            if amount is None:
                continue
            for alert in alerts_by_account[account.pk]:
                evaluated += 1
                triggered += self._evaluate(
                    alert, amount, now, dry_run
                )

        self.stdout.write(
            f'Evaluated {evaluated} alerts on '
            f'{len(accounts)} accounts: {triggered} triggered'
            f'{" (dry run)" if dry_run else ""}'
        )

    @staticmethod
    def _balance_amount(balance, account):
        """Decimal amount of a GoCardless balance payload, or None
        when it is unusable for this account."""
        raw = (balance.get('balanceAmount') or {}).get('amount')
        currency = (balance.get('balanceAmount') or {}).get(
            'currency'
        )
        if raw is None:
            logger.warning(
                'Balance for account %s carries no amount — '
                'skipping its alerts',
                account.account_id,
            )
            return None
        if currency and currency != account.currency:
            logger.warning(
                'Balance currency %s does not match account %s '
                'currency %s — skipping its alerts',
                currency, account.account_id, account.currency,
            )
            return None
        try:
            return Decimal(str(raw))
        except InvalidOperation:
            logger.warning(
                'Balance amount %r for account %s is not a number '
                '— skipping its alerts',
                raw, account.account_id,
            )
            return None

    def _evaluate(self, alert, amount, now, dry_run):
        """One alert against one fresh balance; 1 when it fired."""
        account = alert.account
        if amount < alert.threshold:
            if (
                alert.alerted_at is not None
                and now - alert.alerted_at < ALERT_REPEAT_AFTER
            ):
                # Still in the repeat cooldown — told recently.
                return 0
            logger.warning(
                'BALANCE_ALERT_TRIGGERED user=%s account=%s '
                'balance=%s threshold=%s currency=%s',
                alert.user.username, account.account_id,
                amount, alert.threshold, account.currency,
            )
            if not dry_run:
                self._notify(alert, amount)
                # Stamped unconditionally: the Notification row is
                # the record of delivery, push is opportunistic.
                alert.alerted_at = now
                alert.save(
                    update_fields=['alerted_at', 'updated_at']
                )
            return 1
        if alert.alerted_at is not None and not dry_run:
            # Back at/above the threshold — episode over, the next
            # drop alerts again.
            alert.alerted_at = None
            alert.save(update_fields=['alerted_at', 'updated_at'])
        return 0

    @staticmethod
    def _notify(alert, amount):
        account = alert.account
        name = (
            account.name or account.iban or account.account_id
        )
        currency = account.currency
        url = reverse('finance:balances')
        with translation.override(user_language(alert.user)):
            title = gettext('Low balance')
            body = gettext(
                '{account}: {balance} — below your {threshold} alert'
            ).format(
                account=name,
                balance=fmt_money(amount, currency),
                threshold=fmt_money(alert.threshold, currency),
            )
        Notification.objects.create(
            user=alert.user, title=title, body=body, url=url
        )
        send_limit_alert(alert.user, title, body, url)
