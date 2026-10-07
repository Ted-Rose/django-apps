import hashlib
import json
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


def fetch_transactions_payload(client, account):
    """Fetch the transactions payload for one account.

    ``date_from`` is the latest booked ``booking_date`` — non-booked
    rows are excluded so a pending entry's value date can't push the
    cursor forward and skip real bookings.
    """
    date_from = account.transactions.filter(
        status=Transaction.STATUS_BOOKED
    ).aggregate(Max('booking_date'))['booking_date__max']
    return client.fetch_transactions(
        account.account_id, date_from=date_from
    )


def _entry_digest(entry):
    """Stable id for groups whose entries carry no transactionId
    (pending card holds etc.) — derived from content so the same
    entry maps to the same row across syncs."""
    amount_data = entry.get('transactionAmount') or {}
    payload = json.dumps(
        {
            'amount': amount_data.get('amount'),
            'currency': amount_data.get('currency'),
            'bookingDate': entry.get('bookingDate'),
            'valueDate': entry.get('valueDate'),
            'valueDateTime': entry.get('valueDateTime'),
            'remittance': entry.get(
                'remittanceInformationUnstructured'
            ),
            'remittanceArray': entry.get(
                'remittanceInformationUnstructuredArray'
            ),
            'internalTransactionId': entry.get(
                'internalTransactionId'
            ),
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:24]


def _entry_defaults(entry, status, account):
    """Map a GoCardless transaction entry to Transaction defaults;
    None when the entry can't be stored."""
    amount_data = entry.get('transactionAmount') or {}
    try:
        amount = Decimal(str(amount_data.get('amount', '0')))
    except InvalidOperation:
        logger.warning(
            'Skipping %s transaction with bad amount %r on '
            'account %s',
            status, amount_data.get('amount'), account.account_id,
        )
        return None
    booking_date = entry.get('bookingDate')
    if status != Transaction.STATUS_BOOKED:
        # Non-booked entries (e.g. pending card holds) usually lack
        # bookingDate — fall back to the value date since
        # booking_date is NOT NULL and drives ordering.
        booking_date = booking_date or entry.get('valueDate')
    if not booking_date:
        logger.warning(
            'Skipping %s transaction without a date on account %s',
            status, account.account_id,
        )
        return None

    remittance_array = entry.get(
        'remittanceInformationUnstructuredArray'
    )
    remittance = entry.get('remittanceInformationUnstructured')
    if remittance is None and remittance_array:
        remittance = '\n'.join(remittance_array)

    return {
        'status': status,
        'internal_transaction_id': entry.get(
            'internalTransactionId'
        ),
        'amount': amount,
        'currency': amount_data.get('currency', 'EUR'),
        'booking_date': booking_date,
        'booking_date_time': parse_datetime(
            entry.get('bookingDateTime') or ''
        ),
        'value_date': entry.get('valueDate'),
        'value_date_time': parse_datetime(
            entry.get('valueDateTime') or ''
        ),
        'end_to_end_id': entry.get('endToEndId'),
        'bank_transaction_code': entry.get('bankTransactionCode'),
        'remittance_information': remittance,
        'remittance_information_array': remittance_array,
        'debtor_name': entry.get('debtorName'),
        'debtor_account': entry.get('debtorAccount'),
        'creditor_name': entry.get('creditorName'),
        'creditor_account': entry.get('creditorAccount'),
        'additional_information': entry.get('additionalInformation'),
        'additional_data_structured': entry.get(
            'additionalDataStructured'
        ),
        'proprietary_bank_transaction_code': entry.get(
            'proprietaryBankTransactionCode'
        ),
        'balance_after_transaction': entry.get(
            'balanceAfterTransaction'
        ),
    }


def iter_status_entries(entries, status, account):
    """Yield (transaction_id, defaults) for one status group.

    Entries without transactionId/internalTransactionId get a
    deterministic ``<status>-<digest>`` id (with an occurrence
    suffix for identical duplicates); booked entries without any id
    are skipped like before.
    """
    digest_counts = {}
    for entry in entries:
        defaults = _entry_defaults(entry, status, account)
        if defaults is None:
            continue
        transaction_id = (
            entry.get('transactionId')
            or entry.get('internalTransactionId')
        )
        if not transaction_id:
            if status == Transaction.STATUS_BOOKED:
                logger.warning(
                    'Skipping booked transaction without id on '
                    'account %s',
                    account.account_id,
                )
                continue
            digest = f'{status}-{_entry_digest(entry)}'
            count = digest_counts.get(digest, 0)
            digest_counts[digest] = count + 1
            transaction_id = (
                digest if count == 0 else f'{digest}-{count + 1}'
            )
        yield transaction_id, defaults


def sync_account_transactions(client, account):
    """Sync transactions for one account.

    The GoCardless payload groups entries by status (booked,
    pending, ...). Booked rows are only ever upserted; other groups
    are snapshots, so rows that left the list (booked or released)
    are deleted. Each transaction is categorized per viewer: the
    account owner's ruleset plus every sharer's.
    Returns (created, updated) counts.
    """
    data = fetch_transactions_payload(client, account)
    created = 0
    updated = 0
    users = [account.owner] + [
        share.shared_with
        for share in account.shares.select_related('shared_with')
    ]
    rules_by_user = {
        user: active_rules_for(user) for user in users
    }
    # Booked first, so a pending duplicate of a booked id can't be
    # deleted by the stale-row sweep below.
    groups = sorted(
        data.items(),
        key=lambda item: item[0] != Transaction.STATUS_BOOKED,
    )
    transient_ids = set()
    for status, entries in groups:
        if not isinstance(entries, list):
            continue
        for transaction_id, defaults in iter_status_entries(
            entries, status, account
        ):
            transaction, was_created = (
                Transaction.objects.update_or_create(
                    account=account,
                    transaction_id=transaction_id,
                    defaults=defaults,
                )
            )
            for user, rules in rules_by_user.items():
                categorize_transaction(transaction, rules, user)
            if status != Transaction.STATUS_BOOKED:
                transient_ids.add(transaction_id)
            if was_created:
                created += 1
            else:
                updated += 1
    # Non-booked groups are snapshots: entries leave the list once
    # they book or are released — mirror that locally (also covers
    # banks that omit the pending key entirely).
    account.transactions.exclude(
        status=Transaction.STATUS_BOOKED
    ).exclude(transaction_id__in=transient_ids).delete()
    return created, updated
