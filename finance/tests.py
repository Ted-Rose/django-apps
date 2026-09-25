import json
from decimal import Decimal
from unittest.mock import MagicMock, patch

from pywebpush import WebPushException

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from django.urls import reverse

from finance.models import (
    Account,
    AccountShare,
    Category,
    CategoryRule,
    PushSubscription,
    Requisition,
    Transaction,
    TransactionLimit,
    UserTransactionCategory,
)
from finance.services.push import send_limit_alert
from finance.services.categories import (
    annotate_effective_category,
    effective_category_for,
)
from finance.services.rules import (
    apply_rules,
    preview_rule,
    rule_matches,
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


def make_transaction(account, transaction_id, amount, days_ago=0,
                     **fields):
    return Transaction.objects.create(
        account=account,
        transaction_id=transaction_id,
        amount=Decimal(amount),
        booking_date=(
            timezone.now().date()
            - timezone.timedelta(days=days_ago)
        ),
        **fields,
    )


def make_category(user, name='Groceries', color=''):
    return Category.objects.create(user=user, name=name, color=color)


def make_assignment(user, transaction, category, is_manual=False):
    return UserTransactionCategory.objects.create(
        user=user,
        transaction=transaction,
        category=category,
        is_manual=is_manual,
    )


def make_subscription(user, endpoint='https://push.example.com/s/1'):
    return PushSubscription.objects.create(
        user=user,
        endpoint=endpoint,
        p256dh='p256dh-key',
        auth='auth-secret',
    )


def make_rule(user, category, priority=1, sender='', description='',
              match_type='contains', operator='AND', is_active=True):
    return CategoryRule.objects.create(
        user=user,
        category=category,
        priority=priority,
        sender_receiver_pattern=sender,
        description_pattern=description,
        match_type=match_type,
        operator=operator,
        is_active=is_active,
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

    def test_category_limit_exceeded_logs_warning(self):
        groceries = make_category(self.user)
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            category=groceries,
            limit_7_days=Decimal('100.00'),
        )
        make_assignment(
            self.user,
            make_transaction(self.account, 't-1', '-60.00',
                             days_ago=1),
            groceries,
        )
        make_assignment(
            self.user,
            make_transaction(self.account, 't-2', '-50.00',
                             days_ago=2),
            groceries,
        )

        mock_logger = self.run_command()
        mock_logger.warning.assert_called_once()
        self.assertIn(
            'Groceries', str(mock_logger.warning.call_args)
        )

    def test_category_limit_ignores_other_categories(self):
        groceries = make_category(self.user)
        dining = make_category(self.user, 'Dining')
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            category=groceries,
            limit_7_days=Decimal('100.00'),
        )
        make_assignment(
            self.user,
            make_transaction(self.account, 't-1', '-150.00',
                             days_ago=1),
            dining,
        )
        make_transaction(self.account, 't-2', '-150.00', days_ago=1)

        mock_logger = self.run_command()
        mock_logger.warning.assert_not_called()

    def test_sharer_category_limit_uses_own_assignments(self):
        """A shared user's limit counts their own assignments only."""
        sharer = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        AccountShare.objects.create(
            account=self.account, shared_with=sharer
        )
        owner_cat = make_category(self.user, 'OwnerCat')
        sharer_cat = make_category(sharer, 'Groceries')
        TransactionLimit.objects.create(
            account=self.account,
            user=sharer,
            category=sharer_cat,
            limit_7_days=Decimal('100.00'),
        )
        tx = make_transaction(self.account, 't-1', '-150.00',
                              days_ago=1)
        # The owner's assignment must not feed the sharer's limit.
        make_assignment(self.user, tx, owner_cat)
        make_assignment(sharer, tx, sharer_cat)

        mock_logger = self.run_command()
        mock_logger.warning.assert_called_once()

    def test_owner_assignments_do_not_trigger_sharer_limit(self):
        sharer = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        AccountShare.objects.create(
            account=self.account, shared_with=sharer
        )
        owner_cat = make_category(self.user, 'OwnerCat')
        sharer_cat = make_category(sharer, 'Groceries')
        TransactionLimit.objects.create(
            account=self.account,
            user=sharer,
            category=sharer_cat,
            limit_7_days=Decimal('100.00'),
        )
        make_assignment(
            self.user,
            make_transaction(self.account, 't-1', '-150.00',
                             days_ago=1),
            owner_cat,
        )

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

    def test_sync_assigns_category_via_owner_rules(self):
        category = make_category(self.user)
        make_rule(self.user, category, sender='Shop')
        self.run_command([
            {
                'transactionId': 'tx-1',
                'bookingDate': '2026-09-20',
                'transactionAmount': {
                    'amount': '-12.34', 'currency': 'EUR',
                },
                'creditorName': 'Shop',
            },
        ])
        tx = Transaction.objects.get(
            account=self.account, transaction_id='tx-1'
        )
        assignment = UserTransactionCategory.objects.get(
            user=self.user, transaction=tx
        )
        self.assertEqual(assignment.category, category)

    def test_sync_writes_owner_and_sharer_rows(self):
        sharer = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        AccountShare.objects.create(
            account=self.account, shared_with=sharer
        )
        owner_cat = make_category(self.user, 'OwnerCat')
        sharer_cat = make_category(sharer, 'SharerCat')
        make_rule(self.user, owner_cat, sender='Shop')
        make_rule(sharer, sharer_cat, sender='Shop')
        self.run_command([
            {
                'transactionId': 'tx-1',
                'bookingDate': '2026-09-20',
                'transactionAmount': {
                    'amount': '-12.34', 'currency': 'EUR',
                },
                'creditorName': 'Shop',
            },
        ])
        tx = Transaction.objects.get(
            account=self.account, transaction_id='tx-1'
        )
        self.assertEqual(
            UserTransactionCategory.objects.get(
                user=self.user, transaction=tx
            ).category,
            owner_cat,
        )
        self.assertEqual(
            UserTransactionCategory.objects.get(
                user=sharer, transaction=tx
            ).category,
            sharer_cat,
        )


class RuleMatchingTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.category = make_category(self.user)

    def test_contains_matches_description(self):
        rule = make_rule(self.user, self.category,
                         description='grocery')
        tx = make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='Weekly grocery run',
        )
        self.assertTrue(rule_matches(rule, tx))

    def test_equals_and_starts_with(self):
        tx = make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='rent september',
        )
        self.assertTrue(rule_matches(
            make_rule(self.user, self.category, description='rent',
                      match_type='starts_with'),
            tx,
        ))
        self.assertTrue(rule_matches(
            make_rule(self.user, self.category,
                      description='Rent September',
                      match_type='equals'),
            tx,
        ))
        self.assertFalse(rule_matches(
            make_rule(self.user, self.category,
                      description='september', match_type='equals'),
            tx,
        ))
        self.assertTrue(rule_matches(
            make_rule(self.user, self.category,
                      description='September', match_type='ends_with'),
            tx,
        ))
        self.assertFalse(rule_matches(
            make_rule(self.user, self.category,
                      description='rent', match_type='ends_with'),
            tx,
        ))

    def test_sender_receiver_matches_debtor_or_creditor(self):
        rule = make_rule(self.user, self.category, sender='employer')
        incoming = make_transaction(
            self.account, 't-1', '500.00', debtor_name='Employer Ltd',
        )
        outgoing = make_transaction(
            self.account, 't-2', '-5.00', creditor_name='Employer Ltd',
        )
        self.assertTrue(rule_matches(rule, incoming))
        self.assertTrue(rule_matches(rule, outgoing))

    def test_and_requires_both_or_accepts_either(self):
        tx = make_transaction(
            self.account, 't-1', '-10.00',
            creditor_name='Shop',
            remittance_information='card payment',
        )
        and_rule = make_rule(
            self.user, self.category,
            sender='shop', description='invoice', operator='AND',
        )
        or_rule = make_rule(
            self.user, self.category, priority=2,
            sender='shop', description='invoice', operator='OR',
        )
        self.assertFalse(rule_matches(and_rule, tx))
        self.assertTrue(rule_matches(or_rule, tx))

    def test_rule_with_no_patterns_never_matches(self):
        rule = make_rule(self.user, self.category)
        tx = make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='anything',
        )
        self.assertFalse(rule_matches(rule, tx))


class ApplyRulesTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.other = User.objects.create_user(
            username='bob', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.groceries = make_category(self.user)
        self.other_cat = make_category(self.user, 'Other')

    def test_first_match_wins_by_priority(self):
        make_rule(self.user, self.groceries, priority=1,
                  description='shop')
        make_rule(self.user, self.other_cat, priority=2,
                  description='shop')
        tx = make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        changed = apply_rules(self.user)
        self.assertEqual(
            effective_category_for(tx, self.user), self.groceries
        )
        self.assertEqual(changed, 1)

    def test_unmatched_transaction_category_cleared(self):
        tx = make_transaction(self.account, 't-1', '-10.00')
        make_assignment(self.user, tx, self.groceries)
        make_rule(self.user, self.other_cat, description='nomatch')
        apply_rules(self.user)
        self.assertIsNone(effective_category_for(tx, self.user))

    def test_manual_category_never_overwritten(self):
        make_rule(self.user, self.other_cat, description='shop')
        tx = make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        make_assignment(
            self.user, tx, self.groceries, is_manual=True
        )
        apply_rules(self.user)
        self.assertEqual(
            effective_category_for(tx, self.user), self.groceries
        )

    def test_inactive_rules_skipped(self):
        make_rule(self.user, self.groceries, description='shop',
                  is_active=False)
        tx = make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        apply_rules(self.user)
        self.assertIsNone(effective_category_for(tx, self.user))

    def test_sharer_rules_write_sharers_own_rows(self):
        AccountShare.objects.create(
            account=self.account, shared_with=self.other
        )
        viewer_cat = make_category(self.other, 'ViewerCat')
        make_rule(self.other, viewer_cat, description='shop')
        tx = make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        changed = apply_rules(self.other)
        self.assertEqual(changed, 1)
        self.assertEqual(
            effective_category_for(tx, self.other), viewer_cat
        )

    def test_owner_and_sharer_assignments_stay_separate(self):
        AccountShare.objects.create(
            account=self.account, shared_with=self.other
        )
        viewer_cat = make_category(self.other, 'ViewerCat')
        make_rule(self.user, self.groceries, description='shop')
        make_rule(self.other, viewer_cat, description='shop')
        tx = make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        apply_rules(self.user)
        apply_rules(self.other)
        self.assertEqual(
            effective_category_for(tx, self.user), self.groceries
        )
        self.assertEqual(
            effective_category_for(tx, self.other), viewer_cat
        )
        self.assertEqual(
            UserTransactionCategory.objects.filter(
                transaction=tx
            ).count(),
            2,
        )

    def test_share_revoke_deletes_viewer_assignments(self):
        share = AccountShare.objects.create(
            account=self.account, shared_with=self.other
        )
        tx = make_transaction(self.account, 't-1', '-10.00')
        make_assignment(self.user, tx, self.groceries)
        viewer_cat = make_category(self.other, 'ViewerCat')
        make_assignment(self.other, tx, viewer_cat)

        share.delete()

        self.assertFalse(
            UserTransactionCategory.objects.filter(
                user=self.other, transaction=tx
            ).exists()
        )
        self.assertTrue(
            UserTransactionCategory.objects.filter(
                user=self.user, transaction=tx
            ).exists()
        )


class EffectiveCategoryTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.other = User.objects.create_user(
            username='bob', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        AccountShare.objects.create(
            account=self.account, shared_with=self.other
        )

    def annotate(self, user):
        return annotate_effective_category(
            Transaction.objects.for_user(user), user
        )

    def test_owner_sees_own_assignment(self):
        tx = make_transaction(self.account, 't-1', '-10.00')
        cat = make_category(self.user)
        make_assignment(self.user, tx, cat)
        annotated = self.annotate(self.user).get(pk=tx.pk)
        self.assertEqual(annotated.effective_category_id, cat.pk)

    def test_sharer_sees_own_assignment_not_owners(self):
        tx = make_transaction(self.account, 't-1', '-10.00')
        owner_cat = make_category(self.user, 'OwnerCat')
        sharer_cat = make_category(self.other, 'SharerCat')
        make_assignment(self.user, tx, owner_cat)
        make_assignment(self.other, tx, sharer_cat)
        annotated = self.annotate(self.other).get(pk=tx.pk)
        self.assertEqual(
            annotated.effective_category_id, sharer_cat.pk
        )

    def test_sharer_sees_uncategorized_without_own_row(self):
        tx = make_transaction(self.account, 't-1', '-10.00')
        owner_cat = make_category(self.user, 'OwnerCat')
        make_assignment(self.user, tx, owner_cat)
        annotated = self.annotate(self.other).get(pk=tx.pk)
        self.assertIsNone(annotated.effective_category_id)

    def test_owner_assignments_never_leak_to_sharer(self):
        tx = make_transaction(self.account, 't-1', '-10.00')
        make_assignment(self.user, tx, make_category(self.user))
        self.assertIsNone(effective_category_for(tx, self.other))


class PreviewRuleTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.groceries = make_category(self.user)
        self.other_cat = make_category(self.user, 'Other')

    def preview_data(self, **overrides):
        data = {
            'category_id': str(self.groceries.pk),
            'priority': '1',
            'sender_receiver_pattern': '',
            'description_pattern': 'shop',
            'match_type': 'contains',
            'operator': 'AND',
            'is_active': 'on',
        }
        data.update(overrides)
        return data

    def test_reports_match_and_change_counts(self):
        make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop run',
        )
        make_transaction(
            self.account, 't-2', '-5.00',
            remittance_information='rent',
        )
        result = preview_rule(self.user, self.preview_data())
        self.assertEqual(result['match_count'], 1)
        self.assertEqual(result['apply_count'], 1)
        self.assertEqual(result['changes_total'], 1)
        self.assertEqual(
            result['changes'][0]['new_category'], 'Groceries'
        )

    def test_lower_priority_loses_first_match(self):
        make_rule(self.user, self.other_cat, priority=1,
                  description='shop')
        make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        result = preview_rule(
            self.user, self.preview_data(priority='2')
        )
        self.assertEqual(result['match_count'], 1)
        self.assertEqual(result['apply_count'], 0)

    def test_edit_replaces_existing_rule(self):
        rule = make_rule(self.user, self.other_cat, priority=1,
                         description='shop')
        make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        result = preview_rule(
            self.user,
            self.preview_data(rule_id=str(rule.pk)),
        )
        self.assertEqual(result['apply_count'], 1)
        self.assertEqual(
            result['changes'][0]['old_category'], None
        )
        self.assertEqual(
            result['changes'][0]['new_category'], 'Groceries'
        )

    def test_error_without_category(self):
        result = preview_rule(
            self.user, self.preview_data(category_id='')
        )
        self.assertIn('error', result)

    def test_preview_writes_nothing(self):
        make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        preview_rule(self.user, self.preview_data())
        self.assertFalse(UserTransactionCategory.objects.exists())

    def test_preview_uses_previewing_users_assignments(self):
        """Old/new diff reflects the previewing user's own rows."""
        sharer = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        AccountShare.objects.create(
            account=self.account, shared_with=sharer
        )
        owner_cat = self.groceries
        sharer_cat = make_category(sharer, 'SharerCat')
        tx = make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        make_assignment(self.user, tx, owner_cat)

        # The sharer previews their own rule: their row is absent, so
        # the diff is None -> their category, not the owner's.
        data = self.preview_data(category_id=str(sharer_cat.pk))
        result = preview_rule(sharer, data)
        self.assertEqual(result['changes_total'], 1)
        self.assertIsNone(result['changes'][0]['old_category'])
        self.assertEqual(
            result['changes'][0]['new_category'], 'SharerCat'
        )


class TransactionListViewTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.other = User.objects.create_user(
            username='bob', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)

    def test_shows_users_own_category(self):
        cat = make_category(self.user, 'Groceries')
        tx = make_transaction(self.account, 't-1', '-10.00')
        make_assignment(self.user, tx, cat)
        self.client.force_login(self.user)
        response = self.client.get(reverse('finance:transactions'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Groceries')

    def test_category_filter_matches_effective_category(self):
        cat = make_category(self.user, 'Groceries')
        tx = make_transaction(self.account, 't-1', '-10.00')
        make_assignment(self.user, tx, cat)
        other_tx = make_transaction(self.account, 't-2', '-5.00')
        self.client.force_login(self.user)
        response = self.client.get(
            reverse('finance:transactions'),
            {'category': str(cat.pk)},
        )
        txs = response.context['transactions']
        self.assertEqual([t.pk for t in txs], [tx.pk])
        response = self.client.get(
            reverse('finance:transactions'), {'category': 'none'}
        )
        txs = response.context['transactions']
        self.assertEqual([t.pk for t in txs], [other_tx.pk])

    def test_sharer_sees_only_own_categories(self):
        AccountShare.objects.create(
            account=self.account, shared_with=self.other
        )
        owner_cat = make_category(self.user, 'OwnerCat')
        tx = make_transaction(self.account, 't-1', '-10.00')
        make_assignment(self.user, tx, owner_cat)
        self.client.force_login(self.other)
        response = self.client.get(reverse('finance:transactions'))
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, 'OwnerCat')

    def test_sort_by_amount(self):
        small = make_transaction(self.account, 't-1', '-5.00')
        large = make_transaction(self.account, 't-2', '-50.00')
        self.client.force_login(self.user)
        response = self.client.get(
            reverse('finance:transactions'),
            {'sort': 'amount', 'direction': 'asc'},
        )
        txs = list(response.context['transactions'])
        self.assertEqual([t.pk for t in txs], [large.pk, small.pk])

    def test_sort_by_category_name(self):
        cat_b = make_category(self.user, 'Beta')
        cat_a = make_category(self.user, 'Alpha')
        tx_b = make_transaction(self.account, 't-1', '-10.00')
        tx_a = make_transaction(self.account, 't-2', '-5.00')
        make_assignment(self.user, tx_b, cat_b)
        make_assignment(self.user, tx_a, cat_a)
        self.client.force_login(self.user)
        response = self.client.get(
            reverse('finance:transactions'),
            {'sort': 'category', 'direction': 'asc'},
        )
        txs = list(response.context['transactions'])
        self.assertEqual([t.pk for t in txs], [tx_a.pk, tx_b.pk])

    def test_creditor_filter_and_options(self):
        tx = make_transaction(
            self.account, 't-1', '-10.00', creditor_name='Rimi'
        )
        make_transaction(
            self.account, 't-2', '-5.00', creditor_name='Maxima'
        )
        self.client.force_login(self.user)
        response = self.client.get(
            reverse('finance:transactions'), {'creditor': 'Rimi'}
        )
        self.assertEqual(
            [t.pk for t in response.context['transactions']],
            [tx.pk],
        )
        response = self.client.get(reverse('finance:transactions'))
        names = {
            o['name'] for o in response.context['creditor_options']
        }
        self.assertEqual(names, {'Rimi', 'Maxima'})

    def test_creditor_falls_back_to_debtor_name(self):
        tx = make_transaction(
            self.account, 't-1', '10.00', debtor_name='Employer'
        )
        self.client.force_login(self.user)
        response = self.client.get(
            reverse('finance:transactions'), {'creditor': 'Employer'}
        )
        self.assertEqual(
            [t.pk for t in response.context['transactions']],
            [tx.pk],
        )

    def test_description_search(self):
        tx = make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='monthly rent',
        )
        make_transaction(
            self.account, 't-2', '-5.00',
            remittance_information='groceries',
        )
        self.client.force_login(self.user)
        response = self.client.get(
            reverse('finance:transactions'), {'q': 'rent'}
        )
        self.assertEqual(
            [t.pk for t in response.context['transactions']],
            [tx.pk],
        )
        self.assertEqual(response.context['search_query'], 'rent')

    def test_account_options_mark_selected(self):
        other = make_account(self.user, self.req, 'acc-2')
        self.client.force_login(self.user)
        response = self.client.get(reverse('finance:transactions'))
        self.assertEqual(len(response.context['account_options']), 2)
        response = self.client.get(
            reverse('finance:transactions'), {'account': str(other.pk)}
        )
        selected = [
            o['label'] for o in response.context['account_options']
            if o['selected']
        ]
        self.assertEqual(selected, ['acc-2'])

    def test_invalid_params_ignored(self):
        make_transaction(self.account, 't-1', '-10.00')
        self.client.force_login(self.user)
        response = self.client.get(
            reverse('finance:transactions'),
            {'account': 'x', 'category': 'x', 'sort': 'x'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.context['transactions']), 1)


class CategoryOverviewViewTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)

    def test_groups_by_users_own_assignments(self):
        cat = make_category(self.user, 'Groceries', color='#00ff00')
        tx = make_transaction(self.account, 't-1', '-10.00')
        make_assignment(self.user, tx, cat)
        make_transaction(self.account, 't-2', '-5.00')
        self.client.force_login(self.user)
        response = self.client.get(reverse('finance:categories'))
        self.assertEqual(response.status_code, 200)
        rows = response.context['rows']
        names = {row['category_name'] for row in rows}
        self.assertEqual(names, {'Groceries', 'Uncategorized'})
        groceries = next(
            row for row in rows if row['category_name'] == 'Groceries'
        )
        self.assertEqual(groceries['spent'], Decimal('10.00'))
        self.assertEqual(groceries['category_color'], '#00ff00')


class RuleViewTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.other = User.objects.create_user(
            username='bob', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.category = make_category(self.user)

    def test_preview_endpoint_requires_login(self):
        response = self.client.post(reverse('finance:preview_rule'))
        self.assertEqual(response.status_code, 302)

    def test_preview_endpoint_returns_json(self):
        self.client.force_login(self.user)
        make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        response = self.client.post(
            reverse('finance:preview_rule'),
            {
                'category_id': self.category.pk,
                'priority': 1,
                'description_pattern': 'shop',
                'match_type': 'contains',
                'operator': 'AND',
                'is_active': 'on',
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['success'])
        self.assertEqual(data['changes_total'], 1)

    def test_preview_endpoint_rejects_missing_category(self):
        self.client.force_login(self.user)
        response = self.client.post(
            reverse('finance:preview_rule'),
            {'description_pattern': 'shop'},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.json())

    def test_save_rule_scoped_to_owner(self):
        rule = make_rule(self.user, self.category,
                         description='shop')
        self.client.force_login(self.other)
        response = self.client.post(
            reverse('finance:save_rule'),
            {
                'rule_id': rule.pk,
                'category': self.category.pk,
                'priority': 1,
                'description_pattern': 'hijack',
                'match_type': 'contains',
                'operator': 'AND',
            },
        )
        self.assertEqual(response.status_code, 404)
        rule.refresh_from_db()
        self.assertEqual(rule.description_pattern, 'shop')

    def test_save_rule_applies_to_history(self):
        self.client.force_login(self.user)
        make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        response = self.client.post(
            reverse('finance:save_rule'),
            {
                'category': self.category.pk,
                'priority': 1,
                'description_pattern': 'shop',
                'match_type': 'contains',
                'operator': 'AND',
                'is_active': 'on',
            },
        )
        self.assertEqual(response.status_code, 302)
        tx = Transaction.objects.get(transaction_id='t-1')
        self.assertEqual(
            effective_category_for(tx, self.user), self.category
        )

    def test_move_rule_swaps_priority(self):
        other_cat = make_category(self.user, 'Other')
        first = make_rule(self.user, self.category, priority=1,
                          description='a')
        second = make_rule(self.user, other_cat, priority=2,
                           description='b')
        self.client.force_login(self.user)
        self.client.post(
            reverse('finance:move_rule', args=[second.pk]),
            {'direction': 'up'},
        )
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((second.priority, first.priority), (1, 2))


class SendLimitAlertTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )

    def test_sends_to_all_user_subscriptions(self):
        make_subscription(self.user, 'https://push.example.com/a')
        make_subscription(self.user, 'https://push.example.com/b')

        with override_settings(
            VAPID_PRIVATE_KEY='priv', VAPID_SUBJECT='mailto:t@t.dev'
        ), patch('finance.services.push.webpush') as mock_push:
            send_limit_alert(
                self.user, 'Title', 'Body', '/finance/limits/'
            )

        self.assertEqual(mock_push.call_count, 2)
        endpoints = {
            call.kwargs['subscription_info']['endpoint']
            for call in mock_push.call_args_list
        }
        self.assertEqual(
            endpoints,
            {
                'https://push.example.com/a',
                'https://push.example.com/b',
            },
        )
        payload = json.loads(mock_push.call_args.kwargs['data'])
        self.assertEqual(payload['url'], '/finance/limits/')
        self.assertEqual(
            mock_push.call_args.kwargs['vapid_private_key'], 'priv'
        )
        self.assertEqual(
            mock_push.call_args.kwargs['vapid_claims'],
            {'sub': 'mailto:t@t.dev'},
        )

    def test_gone_subscription_row_deleted(self):
        make_subscription(self.user)
        response = MagicMock()
        response.status_code = 410

        with override_settings(VAPID_PRIVATE_KEY='priv'), patch(
            'finance.services.push.webpush',
            side_effect=WebPushException('gone', response=response),
        ):
            send_limit_alert(self.user, 't', 'b', '/u')

        self.assertFalse(PushSubscription.objects.exists())

    def test_server_error_keeps_row_and_warns(self):
        make_subscription(self.user)
        response = MagicMock()
        response.status_code = 500

        with override_settings(VAPID_PRIVATE_KEY='priv'), patch(
            'finance.services.push.webpush',
            side_effect=WebPushException('boom', response=response),
        ), patch('finance.services.push.logger') as mock_logger:
            send_limit_alert(self.user, 't', 'b', '/u')

        self.assertTrue(PushSubscription.objects.exists())
        mock_logger.warning.assert_called_once()

    def test_no_keys_is_noop(self):
        make_subscription(self.user)

        with override_settings(VAPID_PRIVATE_KEY=''), patch(
            'finance.services.push.webpush'
        ) as mock_push:
            send_limit_alert(self.user, 't', 'b', '/u')

        mock_push.assert_not_called()

    def test_unexpected_error_keeps_row_and_logs(self):
        make_subscription(self.user)

        with override_settings(VAPID_PRIVATE_KEY='priv'), patch(
            'finance.services.push.webpush',
            side_effect=ConnectionError('offline'),
        ), patch('finance.services.push.logger') as mock_logger:
            send_limit_alert(self.user, 't', 'b', '/u')

        self.assertTrue(PushSubscription.objects.exists())
        mock_logger.exception.assert_called_once()


class LimitPushAlertCommandTests(TestCase):
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
            '.evaluate_spending_limits.send_limit_alert'
        ) as mock_send:
            call_command('evaluate_spending_limits')
        return mock_send

    def test_breach_sends_one_push_and_sets_flag(self):
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )
        make_transaction(self.account, 't-1', '-150.00', days_ago=1)

        mock_send = self.run_command()

        mock_send.assert_called_once()
        self.assertEqual(
            mock_send.call_args[0][0].pk, self.user.pk
        )
        limit.refresh_from_db()
        self.assertIsNotNone(limit.alerted_7d_at)

    def test_second_run_while_exceeded_sends_nothing(self):
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )
        make_transaction(self.account, 't-1', '-150.00', days_ago=1)

        self.run_command()
        mock_send = self.run_command()

        mock_send.assert_not_called()

    def test_flag_cleared_when_back_under_then_realerts(self):
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )
        tx = make_transaction(self.account, 't-1', '-150.00',
                              days_ago=1)
        self.run_command()

        tx.amount = Decimal('-50.00')
        tx.save()
        self.run_command()
        limit.refresh_from_db()
        self.assertIsNone(limit.alerted_7d_at)

        tx.amount = Decimal('-150.00')
        tx.save()
        mock_send = self.run_command()
        mock_send.assert_called_once()

    def test_both_windows_breach_sends_single_push(self):
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
            limit_30_days=Decimal('100.00'),
        )
        make_transaction(self.account, 't-1', '-150.00', days_ago=1)

        mock_send = self.run_command()

        mock_send.assert_called_once()
        body = mock_send.call_args[0][2]
        self.assertIn('7 days', body)
        self.assertIn('30 days', body)
        limit = TransactionLimit.objects.get(
            user=self.user, account=self.account
        )
        self.assertIsNotNone(limit.alerted_7d_at)
        self.assertIsNotNone(limit.alerted_30d_at)

    def test_flag_cleared_when_threshold_removed(self):
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )
        make_transaction(self.account, 't-1', '-150.00', days_ago=1)
        self.run_command()
        limit.refresh_from_db()
        self.assertIsNotNone(limit.alerted_7d_at)

        limit.limit_7_days = None
        limit.save()
        mock_send = self.run_command()

        mock_send.assert_not_called()
        limit.refresh_from_db()
        self.assertIsNone(limit.alerted_7d_at)


class PushSubscriptionEndpointTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.other = User.objects.create_user(
            username='bob', password='pw'
        )
        self.subscribe_url = reverse('finance:push_subscribe')
        self.unsubscribe_url = reverse('finance:push_unsubscribe')
        self.payload = {
            'endpoint': 'https://push.example.com/sub/1',
            'keys': {'p256dh': 'key', 'auth': 'secret'},
        }

    def post_json(self, url, data):
        return self.client.post(
            url,
            data=json.dumps(data),
            content_type='application/json',
        )

    def test_subscribe_requires_login(self):
        response = self.post_json(self.subscribe_url, self.payload)
        self.assertEqual(response.status_code, 302)

    @override_settings(VAPID_PUBLIC_KEY='pub')
    def test_subscribe_saves_and_updates_row(self):
        self.client.force_login(self.user)
        response = self.post_json(self.subscribe_url, self.payload)
        self.assertEqual(response.status_code, 200)
        sub = PushSubscription.objects.get(user=self.user)
        self.assertEqual(sub.p256dh, 'key')

        updated = dict(self.payload)
        updated['keys'] = {'p256dh': 'key2', 'auth': 'secret2'}
        response = self.post_json(self.subscribe_url, updated)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(PushSubscription.objects.count(), 1)
        sub.refresh_from_db()
        self.assertEqual(sub.p256dh, 'key2')

    @override_settings(VAPID_PUBLIC_KEY='pub')
    def test_subscribe_400_on_missing_fields(self):
        self.client.force_login(self.user)
        response = self.post_json(self.subscribe_url, {})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(PushSubscription.objects.exists())

    @override_settings(VAPID_PUBLIC_KEY='pub')
    def test_subscribe_400_on_non_dict_body(self):
        self.client.force_login(self.user)
        response = self.client.post(
            self.subscribe_url,
            data='[1, 2]',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(PushSubscription.objects.exists())

    @override_settings(VAPID_PUBLIC_KEY='pub')
    def test_subscribe_400_on_non_dict_keys(self):
        self.client.force_login(self.user)
        response = self.post_json(self.subscribe_url, {
            'endpoint': 'https://push.example.com/sub/1',
            'keys': 'not-a-dict',
        })
        self.assertEqual(response.status_code, 400)
        self.assertFalse(PushSubscription.objects.exists())

    @override_settings(VAPID_PUBLIC_KEY='')
    def test_subscribe_400_when_vapid_unconfigured(self):
        self.client.force_login(self.user)
        response = self.post_json(self.subscribe_url, self.payload)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(PushSubscription.objects.exists())

    @override_settings(VAPID_PUBLIC_KEY='pub')
    def test_subscribe_reassigns_foreign_endpoint(self):
        make_subscription(self.other, self.payload['endpoint'])
        self.client.force_login(self.user)
        response = self.post_json(self.subscribe_url, self.payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(PushSubscription.objects.count(), 1)
        sub = PushSubscription.objects.get()
        self.assertEqual(sub.user, self.user)

    def test_unsubscribe_deletes_own_row(self):
        sub = make_subscription(
            self.user, self.payload['endpoint']
        )
        self.client.force_login(self.user)
        response = self.post_json(
            self.unsubscribe_url, {'endpoint': sub.endpoint}
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(PushSubscription.objects.exists())

    def test_unsubscribe_404_for_foreign_endpoint(self):
        sub = make_subscription(
            self.other, self.payload['endpoint']
        )
        self.client.force_login(self.user)
        response = self.post_json(
            self.unsubscribe_url, {'endpoint': sub.endpoint}
        )
        self.assertEqual(response.status_code, 404)
        self.assertTrue(PushSubscription.objects.exists())

    def test_unsubscribe_404_when_absent(self):
        self.client.force_login(self.user)
        response = self.post_json(
            self.unsubscribe_url,
            {'endpoint': 'https://push.example.com/none'},
        )
        self.assertEqual(response.status_code, 404)
