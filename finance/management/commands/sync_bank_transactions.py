import logging

from django.core.management.base import BaseCommand

from finance.models import Account
from finance.services.gocardless import GoCardlessClient
from finance.services.sync import (
    iter_booked_transactions,
    sync_account_transactions,
)

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        'Sync booked transactions for all linked (status=LN) bank '
        'accounts from the GoCardless Bank Account Data API.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Fetch transactions but do not write to the database.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        client = GoCardlessClient()

        accounts = Account.objects.filter(
            requisition__status='LN'
        ).select_related('requisition')

        total_created = 0
        total_updated = 0
        for account in accounts:
            try:
                created, updated = self._sync_account(
                    client, account, dry_run
                )
                total_created += created
                total_updated += updated
            except Exception as exc:
                # Per-account failures (incl. 429 rate limits) must not
                # stop the rest of the sync.
                logger.exception(
                    'Transaction sync failed for account %s: %s',
                    account.account_id, exc,
                )
                self.stderr.write(
                    f'Account {account.account_id}: {exc}'
                )

        self.stdout.write(
            f'Sync complete: {total_created} created, '
            f'{total_updated} updated'
            f'{" (dry run)" if dry_run else ""}'
        )

    def _sync_account(self, client, account, dry_run):
        if not dry_run:
            return sync_account_transactions(client, account)

        count = 0
        for transaction_id, defaults in iter_booked_transactions(
            client, account
        ):
            self.stdout.write(
                f'[dry-run] {account.account_id} '
                f'{transaction_id} {defaults["amount"]} '
                f'{defaults["currency"]}'
            )
            count += 1
        return 0, count
