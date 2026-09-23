import logging
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand
from django.db.models import Max

from finance.models import Account, Transaction
from finance.services.gocardless import GoCardlessClient

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
        date_from = account.transactions.aggregate(
            Max('booking_date')
        )['booking_date__max']

        data = client.fetch_transactions(
            account.account_id, date_from=date_from
        )
        booked = data.get('booked', [])

        created = 0
        updated = 0
        for entry in booked:
            transaction_id = (
                entry.get('transactionId')
                or entry.get('internalTransactionId')
            )
            if not transaction_id:
                logger.warning(
                    'Skipping transaction without id on account %s',
                    account.account_id,
                )
                continue

            amount_data = entry.get('transactionAmount') or {}
            try:
                amount = Decimal(str(amount_data.get('amount', '0')))
            except InvalidOperation:
                logger.warning(
                    'Skipping transaction %s with bad amount %r',
                    transaction_id, amount_data.get('amount'),
                )
                continue

            defaults = {
                'amount': amount,
                'currency': amount_data.get('currency', 'EUR'),
                'booking_date': entry.get('bookingDate'),
                'remittance_information': entry.get(
                    'remittanceInformationUnstructured'
                ),
            }

            if dry_run:
                self.stdout.write(
                    f'[dry-run] {account.account_id} '
                    f'{transaction_id} {defaults["amount"]} '
                    f'{defaults["currency"]}'
                )
                continue

            _, was_created = Transaction.objects.update_or_create(
                account=account,
                transaction_id=transaction_id,
                defaults=defaults,
            )
            if was_created:
                created += 1
            else:
                updated += 1

        return created, updated
