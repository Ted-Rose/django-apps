import logging
from decimal import Decimal, InvalidOperation

from django.db.models import Max

from finance.models import Transaction

logger = logging.getLogger('django')


def iter_booked_transactions(client, account):
    """Yield (transaction_id, defaults) for booked transactions."""
    date_from = account.transactions.aggregate(
        Max('booking_date')
    )['booking_date__max']

    data = client.fetch_transactions(
        account.account_id, date_from=date_from
    )

    for entry in data.get('booked', []):
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

        yield transaction_id, {
            'amount': amount,
            'currency': amount_data.get('currency', 'EUR'),
            'booking_date': entry.get('bookingDate'),
            'remittance_information': entry.get(
                'remittanceInformationUnstructured'
            ),
        }


def sync_account_transactions(client, account):
    """Sync booked transactions for one account.

    Returns (created, updated) counts.
    """
    created = 0
    updated = 0
    for transaction_id, defaults in iter_booked_transactions(
        client, account
    ):
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
