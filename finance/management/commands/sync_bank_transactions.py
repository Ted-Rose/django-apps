import logging

from django.core.management.base import BaseCommand

from finance.models import Account
from finance.services.gocardless import (
    GoCardlessClient,
    GoCardlessError,
)
from finance.services.requisitions import mark_requisition_dead
from finance.services.sync import (
    fetch_transactions_payload,
    iter_status_entries,
    sync_account_transactions,
)

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        'Sync transactions for all linked (status=LN) bank '
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

        logger.info(
            'Starting transaction sync for %d linked account(s)%s',
            accounts.count(),
            ' [dry-run]' if dry_run else '',
        )

        total_created = 0
        total_updated = 0
        # Requisition pks whose consent died mid-run — remaining
        # same-requisition accounts are skipped without another
        # GoCardless call.
        dead = {}
        for account in accounts:
            if account.requisition_id in dead:
                logger.info(
                    'Skipping account %s — requisition is dead '
                    '(%s), bank must be relinked',
                    account.account_id,
                    dead[account.requisition_id],
                )
                continue
            try:
                created, updated = self._sync_account(
                    client, account, dry_run
                )
                logger.info(
                    'Synced account %s: %d created, %d updated',
                    account.account_id, created, updated,
                )
                total_created += created
                total_updated += updated
            except GoCardlessError as exc:
                dead_status = exc.dead_requisition_status
                if dead_status:
                    dead[account.requisition_id] = dead_status
                    if not dry_run:
                        mark_requisition_dead(account, dead_status)
                    self.stderr.write(
                        f'Account {account.account_id}: bank must '
                        f'be relinked (requisition {dead_status})'
                    )
                    continue
                logger.exception(
                    'Transaction sync failed for account %s: %s',
                    account.account_id, exc,
                )
                self.stderr.write(
                    f'Account {account.account_id}: {exc}'
                )
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

        logger.info(
            'Sync complete: %d created, %d updated%s',
            total_created, total_updated,
            ' [dry-run]' if dry_run else '',
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
        data = fetch_transactions_payload(client, account)
        for status, entries in data.items():
            if not isinstance(entries, list):
                continue
            for transaction_id, defaults in iter_status_entries(
                entries, status, account
            ):
                self.stdout.write(
                    f'[dry-run] {account.account_id} {status} '
                    f'{transaction_id} {defaults["amount"]} '
                    f'{defaults["currency"]}'
                )
                count += 1
        return 0, count
