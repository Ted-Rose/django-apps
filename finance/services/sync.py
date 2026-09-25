import logging
from decimal import Decimal, InvalidOperation

from django.db.models import Max
from django.utils.dateparse import parse_datetime

from finance.models import Transaction
from finance.services.rules import (
    active_rules_for,
    categorize_transaction,
)

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
            'internal_transaction_id': entry.get(
                'internalTransactionId'
            ),
            'amount': amount,
            'currency': amount_data.get('currency', 'EUR'),
            'booking_date': entry.get('bookingDate'),
            'booking_date_time': parse_datetime(
                entry.get('bookingDateTime') or ''
            ),
            'remittance_information': entry.get(
                'remittanceInformationUnstructured'
            ),
            'debtor_name': entry.get('debtorName'),
            'debtor_account': entry.get('debtorAccount'),
            'creditor_name': entry.get('creditorName'),
            'creditor_account': entry.get('creditorAccount'),
            'additional_information': entry.get('additionalInformation'),
            'proprietary_bank_transaction_code': entry.get(
                'proprietaryBankTransactionCode'
            ),
        }


def sync_account_transactions(client, account):
    """Sync booked transactions for one account.

    Each transaction is categorized per viewer: the account owner's
    ruleset plus every sharer's. Returns (created, updated) counts.
    """
    created = 0
    updated = 0
    users = [account.owner] + [
        share.shared_with
        for share in account.shares.select_related('shared_with')
    ]
    rules_by_user = {
        user: active_rules_for(user) for user in users
    }
    for transaction_id, defaults in iter_booked_transactions(
        client, account
    ):
        transaction, was_created = Transaction.objects.update_or_create(
            account=account,
            transaction_id=transaction_id,
            defaults=defaults,
        )
        for user, rules in rules_by_user.items():
            categorize_transaction(transaction, rules, user)
        if was_created:
            created += 1
        else:
            updated += 1
    return created, updated
