from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from finance.models import (
    Account,
    AccountShare,
    Requisition,
    Transaction,
    TransactionLimit,
    UserAccountPreference,
)


def make_requisition(user, requisition_id='req-1', status='LN'):
    return Requisition.objects.create(
        user=user,
        requisition_id=requisition_id,
        institution_id='BANK',
        status=status,
        reference=f'ref-{requisition_id}',
    )


def make_account(owner, requisition, account_id='acc-1'):
    return Account.objects.create(
        requisition=requisition,
        owner=owner,
        account_id=account_id,
        institution_id='BANK',
    )


def make_transaction(account, transaction_id, amount, days_ago=0):
    return Transaction.objects.create(
        account=account,
        transaction_id=transaction_id,
        amount=Decimal(amount),
        booking_date=(
            timezone.now().date()
            - timezone.timedelta(days=days_ago)
        ),
    )


class AccountManagerTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.other = User.objects.create_user(
            username='bob', password='pw'
        )
        self.req = make_requisition(self.user)

    def test_for_user_returns_owned_accounts(self):
        account = make_account(self.user, self.req)
        self.assertIn(
            account, Account.objects.for_user(self.user)
        )

    def test_for_user_returns_shared_accounts(self):
        account = make_account(self.other, self.req, 'acc-shared')
        AccountShare.objects.create(
            account=account, shared_with=self.user
        )
        self.assertIn(
            account, Account.objects.for_user(self.user)
        )

    def test_for_user_excludes_unrelated_accounts(self):
        make_account(self.other, self.req, 'acc-other')
        self.assertNotIn(
            'acc-other',
            Account.objects.for_user(self.user).values_list(
                'account_id', flat=True
            ),
        )

    def test_for_user_deduplicates_multiple_shares(self):
        account = make_account(self.user, self.req)
        AccountShare.objects.create(
            account=account, shared_with=self.other
        )
        third = get_user_model().objects.create_user(
            username='carol', password='pw'
        )
        AccountShare.objects.create(
            account=account, shared_with=third
        )
        self.assertEqual(
            list(Account.objects.for_user(self.user)),
            [account],
        )


class TransactionManagerTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.other = User.objects.create_user(
            username='bob', password='pw'
        )
        self.req = make_requisition(self.user)

    def test_for_user_scopes_to_accessible_accounts(self):
        account = make_account(self.user, self.req)
        tx = make_transaction(account, 't-1', '-10.00')
        self.assertIn(
            tx, Transaction.objects.for_user(self.user)
        )

    def test_for_user_includes_shared_account_transactions(self):
        account = make_account(self.other, self.req, 'acc-shared')
        AccountShare.objects.create(
            account=account, shared_with=self.user
        )
        tx = make_transaction(account, 't-2', '-5.00')
        self.assertIn(
            tx, Transaction.objects.for_user(self.user)
        )

    def test_for_user_excludes_foreign_transactions(self):
        account = make_account(self.other, self.req, 'acc-other')
        make_transaction(account, 't-3', '-5.00')
        self.assertEqual(
            list(Transaction.objects.for_user(self.user)), []
        )


class EvaluateSpendingLimitsTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)

    def run_command(self):
        with patch(
            'finance.management.commands'
            '.evaluate_spending_limits.logger'
        ) as mock_logger:
            call_command('evaluate_spending_limits')
        return mock_logger

    def test_limit_exceeded_logs_warning(self):
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )
        make_transaction(self.account, 't-1', '-60.00', days_ago=1)
        make_transaction(self.account, 't-2', '-50.00', days_ago=2)

        mock_logger = self.run_command()
        mock_logger.warning.assert_called_once()
        self.assertIn(
            'SPENDING_LIMIT_EXCEEDED',
            mock_logger.warning.call_args[0][0],
        )

    def test_limit_not_exceeded_no_warning(self):
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )
        make_transaction(self.account, 't-1', '-60.00', days_ago=1)

        mock_logger = self.run_command()
        mock_logger.warning.assert_not_called()

    def test_inactive_limit_ignored(self):
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('10.00'),
            is_active=False,
        )
        make_transaction(self.account, 't-1', '-60.00', days_ago=1)

        mock_logger = self.run_command()
        mock_logger.warning.assert_not_called()

    def test_30_day_window_excludes_older_transactions(self):
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_30_days=Decimal('100.00'),
        )
        make_transaction(self.account, 't-1', '-90.00', days_ago=31)

        mock_logger = self.run_command()
        mock_logger.warning.assert_not_called()

    def test_incoming_transactions_ignored(self):
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('10.00'),
        )
        make_transaction(self.account, 't-1', '500.00', days_ago=1)

        mock_logger = self.run_command()
        mock_logger.warning.assert_not_called()


class SyncBankTransactionsTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)

    def run_command(self, booked, **kwargs):
        client = MagicMock()
        client.fetch_transactions.return_value = {'booked': booked}
        with patch(
            'finance.management.commands'
            '.sync_bank_transactions.GoCardlessClient',
            return_value=client,
        ):
            call_command('sync_bank_transactions', **kwargs)
        return client

    def test_upserts_booked_transactions(self):
        self.run_command([
            {
                'transactionId': 'tx-1',
                'bookingDate': '2026-09-20',
                'bookingDateTime': '2026-09-20T12:43:03Z',
                'transactionAmount': {
                    'amount': '-12.34', 'currency': 'EUR',
                },
                'creditorName': 'Shop',
                'creditorAccount': {'iban': 'LV80BANK0000435195001'},
                'remittanceInformationUnstructured': 'Shop purchase',
                'additionalInformation': 'CARD-123',
                'proprietaryBankTransactionCode': 'CARD',
                'internalTransactionId': 'int-tx-1',
            },
        ])
        tx = Transaction.objects.get(
            account=self.account, transaction_id='tx-1'
        )
        self.assertEqual(tx.amount, Decimal('-12.34'))
        self.assertEqual(tx.remittance_information, 'Shop purchase')
        self.assertEqual(tx.internal_transaction_id, 'int-tx-1')
        self.assertEqual(tx.booking_date_time.isoformat(),
                         '2026-09-20T12:43:03+00:00')
        self.assertEqual(tx.creditor_name, 'Shop')
        self.assertEqual(
            tx.creditor_account, {'iban': 'LV80BANK0000435195001'}
        )
        self.assertEqual(tx.additional_information, 'CARD-123')
        self.assertEqual(tx.proprietary_bank_transaction_code, 'CARD')

    def test_falls_back_to_internal_transaction_id(self):
        self.run_command([
            {
                'internalTransactionId': 'int-1',
                'bookingDate': '2026-09-20',
                'transactionAmount': {
                    'amount': '5.00', 'currency': 'EUR',
                },
            },
        ])
        self.assertTrue(
            Transaction.objects.filter(
                account=self.account,
                transaction_id='int-1',
            ).exists()
        )

    def test_dry_run_writes_nothing(self):
        self.run_command([
            {
                'transactionId': 'tx-1',
                'bookingDate': '2026-09-20',
                'transactionAmount': {
                    'amount': '-1.00', 'currency': 'EUR',
                },
            },
        ], dry_run=True)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_skips_unlinked_requisitions(self):
        self.req.status = 'CR'
        self.req.save()
        client = self.run_command([])
        client.fetch_transactions.assert_not_called()
