import json
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch

from pywebpush import WebPushException

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from finance.models import (
    Account,
    AccountShare,
    BalanceAlert,
    Category,
    CategoryRule,
    LimitEvaluation,
    Notification,
    PushSubscription,
    Requisition,
    Transaction,
    TransactionLimit,
    UserAccountPreference,
    UserTransactionCategory,
)
from finance.services.gocardless import (
    GoCardlessClient,
    GoCardlessError,
)
from finance.services.push import send_limit_alert
from finance.services.categories import (
    annotate_effective_category,
    effective_category_for,
)
from finance.services.limits import (
    limit_window_stats,
    monthly_history,
    monthly_period_start,
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
    fields.setdefault(
        'booking_date',
        timezone.now().date() - timezone.timedelta(days=days_ago),
    )
    return Transaction.objects.create(
        account=account,
        transaction_id=transaction_id,
        amount=Decimal(amount),
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
              match_type='contains', operator='AND', is_active=True,
              scope='any', exclusion=''):
    return CategoryRule.objects.create(
        user=user,
        category=category,
        priority=priority,
        counterparty_scope=scope,
        counterparty_pattern=sender,
        counterparty_match_type=match_type,
        description_pattern=description,
        description_match_type=match_type,
        description_exclusion=exclusion,
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

    def test_monthly_window_exceeded_logs_warning(self):
        start = timezone.now().date().replace(day=1)
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )
        make_transaction(
            self.account, 't-1', '-150.00', booking_date=start
        )

        mock_logger = self.run_command()
        mock_logger.warning.assert_called_once()

    def test_monthly_window_excludes_previous_period(self):
        start = timezone.now().date().replace(day=1)
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )
        make_transaction(
            self.account, 't-1', '-60.00', booking_date=start
        )
        make_transaction(
            self.account, 't-2', '-150.00',
            booking_date=start - timezone.timedelta(days=1),
        )

        mock_logger = self.run_command()
        mock_logger.warning.assert_not_called()

    def test_monthly_run_records_evaluation(self):
        start = timezone.now().date().replace(day=1)
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )
        make_transaction(
            self.account, 't-1', '-60.00', booking_date=start
        )

        self.run_command()

        evaluation = LimitEvaluation.objects.get(
            limit=limit, period_start=start
        )
        self.assertEqual(evaluation.spent, Decimal('60.00'))
        self.assertEqual(evaluation.threshold, Decimal('100.00'))
        self.assertFalse(evaluation.exceeded)

    def test_monthly_run_updates_existing_evaluation(self):
        start = timezone.now().date().replace(day=1)
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )
        make_transaction(
            self.account, 't-1', '-60.00', booking_date=start
        )
        self.run_command()

        make_transaction(
            self.account, 't-2', '-70.00', booking_date=start
        )
        self.run_command()

        self.assertEqual(
            LimitEvaluation.objects.filter(
                limit=limit, period_start=start
            ).count(),
            1,
        )
        evaluation = LimitEvaluation.objects.get(
            limit=limit, period_start=start
        )
        self.assertEqual(evaluation.spent, Decimal('130.00'))

    def test_monthly_run_backfills_previous_month(self):
        start = timezone.now().date().replace(day=1)
        previous = (
            start - timezone.timedelta(days=1)
        ).replace(day=1)
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )
        make_transaction(
            self.account, 't-1', '-150.00', booking_date=previous
        )

        self.run_command()

        evaluation = LimitEvaluation.objects.get(
            limit=limit, period_start=previous
        )
        self.assertEqual(evaluation.spent, Decimal('150.00'))
        self.assertTrue(evaluation.exceeded)

    def test_monthly_backfill_keeps_recorded_threshold(self):
        """A changed limit must not rewrite last month's threshold."""
        start = timezone.now().date().replace(day=1)
        previous = (
            start - timezone.timedelta(days=1)
        ).replace(day=1)
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )
        LimitEvaluation.objects.create(
            limit=limit,
            period_start=previous,
            spent=Decimal('60.00'),
            threshold=Decimal('50.00'),
        )
        make_transaction(
            self.account, 't-1', '-80.00', booking_date=previous
        )

        self.run_command()

        evaluation = LimitEvaluation.objects.get(
            limit=limit, period_start=previous
        )
        self.assertEqual(evaluation.threshold, Decimal('50.00'))
        self.assertEqual(evaluation.spent, Decimal('80.00'))

    def test_no_evaluation_recorded_without_monthly_limit(self):
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )

        self.run_command()

        self.assertFalse(LimitEvaluation.objects.exists())


class MonthlyPeriodStartTests(SimpleTestCase):
    def test_returns_first_of_month(self):
        self.assertEqual(
            monthly_period_start(date(2026, 9, 29)),
            date(2026, 9, 1),
        )

    def test_first_day_of_month(self):
        self.assertEqual(
            monthly_period_start(date(2026, 1, 1)),
            date(2026, 1, 1),
        )


class LimitWindowStatsTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)

    def test_stats_report_spent_and_overage(self):
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )
        make_transaction(self.account, 't-1', '-150.00', days_ago=1)

        stats = limit_window_stats(limit)

        self.assertEqual(len(stats), 1)
        self.assertEqual(stats[0]['spent'], Decimal('150.00'))
        self.assertEqual(stats[0]['over'], Decimal('50.00'))
        self.assertEqual(stats[0]['remaining'], Decimal('-50.00'))
        self.assertEqual(stats[0]['bar_class'], 'bg-danger')

    def test_stats_under_limit(self):
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )
        make_transaction(self.account, 't-1', '-30.00', days_ago=1)

        stats = limit_window_stats(limit)

        self.assertEqual(stats[0]['remaining'], Decimal('70.00'))
        self.assertIsNone(stats[0]['over'])
        self.assertEqual(stats[0]['bar_class'], 'bg-success')

    def test_stats_warn_when_mostly_used(self):
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )
        make_transaction(self.account, 't-1', '-90.00', days_ago=1)

        stats = limit_window_stats(limit)

        self.assertEqual(stats[0]['bar_class'], 'bg-warning')

    def test_stats_omit_windows_without_threshold(self):
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )

        stats = limit_window_stats(limit)

        self.assertEqual(len(stats), 1)
        self.assertEqual(stats[0]['label'], 'This month')

    def test_monthly_history_covers_past_months(self):
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )
        this_month = timezone.now().date().replace(day=1)
        last_month_end = this_month - timezone.timedelta(days=1)
        prev_month_end = (
            last_month_end.replace(day=1)
            - timezone.timedelta(days=1)
        )
        make_transaction(
            self.account, 't-1', '-60.00',
            booking_date=last_month_end,
        )
        make_transaction(
            self.account, 't-2', '-150.00',
            booking_date=prev_month_end,
        )
        make_transaction(
            self.account, 't-3', '-30.00', booking_date=this_month,
        )

        history = monthly_history(limit)

        self.assertEqual(len(history), 2)
        self.assertEqual(
            history[0]['label'], last_month_end.strftime('%b %Y')
        )
        self.assertEqual(history[0]['spent'], Decimal('60.00'))
        self.assertEqual(
            history[1]['label'], prev_month_end.strftime('%b %Y')
        )
        self.assertEqual(history[1]['spent'], Decimal('150.00'))
        self.assertEqual(history[1]['over'], Decimal('50.00'))

    def test_monthly_history_prefers_recorded_values(self):
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )
        start = timezone.now().date().replace(day=1)
        previous = (
            start - timezone.timedelta(days=1)
        ).replace(day=1)
        LimitEvaluation.objects.create(
            limit=limit,
            period_start=previous,
            spent=Decimal('80.00'),
            threshold=Decimal('50.00'),
        )
        make_transaction(
            self.account, 't-1', '-999.00', booking_date=previous
        )

        history = monthly_history(limit)

        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]['spent'], Decimal('80.00'))
        self.assertEqual(history[0]['threshold'], Decimal('50.00'))
        self.assertEqual(history[0]['over'], Decimal('30.00'))

    def test_monthly_history_before_bounds_results(self):
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )
        this_month = timezone.now().date().replace(day=1)
        last_month_end = this_month - timezone.timedelta(days=1)
        prev_month = (
            last_month_end.replace(day=1)
            - timezone.timedelta(days=1)
        ).replace(day=1)
        make_transaction(
            self.account, 't-1', '-10.00', booking_date=prev_month
        )
        make_transaction(
            self.account, 't-2', '-20.00',
            booking_date=last_month_end,
        )

        history = monthly_history(
            limit, before=last_month_end.replace(day=1)
        )
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]['spent'], Decimal('10.00'))

    def test_selected_month_stat(self):
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )
        this_month = timezone.now().date().replace(day=1)
        last_month_end = this_month - timezone.timedelta(days=1)
        last_month = last_month_end.replace(day=1)
        make_transaction(
            self.account, 't-1', '-120.00', booking_date=last_month
        )

        stats = limit_window_stats(limit, as_of=last_month_end)

        self.assertEqual(len(stats), 1)
        self.assertEqual(
            stats[0]['label'], last_month.strftime('%B %Y')
        )
        self.assertEqual(stats[0]['spent'], Decimal('120.00'))
        self.assertEqual(stats[0]['over'], Decimal('20.00'))

    def test_rolling_windows_evaluated_as_of_past_date(self):
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )
        this_month = timezone.now().date().replace(day=1)
        as_of = this_month - timezone.timedelta(days=1)
        make_transaction(
            self.account, 't-1', '-40.00',
            booking_date=as_of - timezone.timedelta(days=3),
        )
        make_transaction(
            self.account, 't-2', '-200.00',
            booking_date=as_of - timezone.timedelta(days=20),
        )
        make_transaction(self.account, 't-3', '-60.00', days_ago=0)

        stats = limit_window_stats(limit, as_of=as_of)

        self.assertEqual(stats[0]['spent'], Decimal('40.00'))
        self.assertEqual(stats[0]['remaining'], Decimal('60.00'))

    def test_monthly_history_empty_without_past_data(self):
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )
        make_transaction(self.account, 't-1', '-10.00', days_ago=0)

        self.assertEqual(monthly_history(limit), [])


class LimitsViewTests(TestCase):
    """Limits API — the limits page is the SPA post-cutover, so
    assertions hit /api/finance/limits/ JSON instead of template
    context. Edit-prefill (?edit=) is client-side state now."""

    API = '/api/finance'

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
            limit_monthly=Decimal('500.00'),
        )
        self.client.force_login(self.user)

    def get_limits(self, params=None):
        response = self.client.get(
            f'{self.API}/limits/', params or {}
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def post_json(self, path, payload=None):
        return self.client.post(
            f'{self.API}{path}',
            data=json.dumps(payload or {}),
            content_type='application/json',
        )

    def test_limits_include_window_stats(self):
        limits = self.get_limits()['limits']
        self.assertEqual(len(limits), 1)
        self.assertEqual(
            [s['label'] for s in limits[0]['window_stats']],
            ['7 days', 'This month'],
        )

    def test_limit_row_returned_for_edit(self):
        limits = self.get_limits()['limits']
        self.assertEqual(limits[0]['id'], self.limit.pk)
        self.assertEqual(limits[0]['limit_7_days'], '100.00')
        self.assertEqual(limits[0]['limit_monthly'], '500.00')

    def test_other_users_limits_not_listed(self):
        other = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        TransactionLimit.objects.create(
            account=self.account,
            user=other,
            limit_7_days=Decimal('100.00'),
        )
        limits = self.get_limits()['limits']
        self.assertEqual(
            [limit['id'] for limit in limits], [self.limit.pk]
        )

    def test_month_param_selects_month(self):
        this_month = timezone.now().date().replace(day=1)
        last_month = (
            this_month - timezone.timedelta(days=1)
        ).replace(day=1)
        make_transaction(
            self.account, 't-1', '-120.00', booking_date=last_month
        )

        data = self.get_limits({'month': last_month.strftime('%Y-%m')})

        self.assertEqual(
            data['selected_month'], last_month.strftime('%Y-%m')
        )
        # as_of is the selected month's last day.
        self.assertEqual(
            data['as_of'],
            (this_month - timezone.timedelta(days=1)).isoformat(),
        )

    def test_invalid_month_param_ignored(self):
        data = self.get_limits({'month': 'not-a-month'})
        self.assertIsNone(data['selected_month'])

    def test_future_month_param_ignored(self):
        data = self.get_limits({'month': '2999-01'})
        self.assertIsNone(data['selected_month'])

    def test_delete_limit(self):
        response = self.post_json(
            f'/limits/{self.limit.pk}/delete/'
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])
        self.assertFalse(
            TransactionLimit.objects.filter(pk=self.limit.pk).exists()
        )

    def test_delete_other_users_limit_404(self):
        other = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        foreign = TransactionLimit.objects.create(
            account=self.account,
            user=other,
            limit_7_days=Decimal('100.00'),
        )
        response = self.post_json(
            f'/limits/{foreign.pk}/delete/'
        )
        self.assertEqual(response.status_code, 404)
        self.assertTrue(
            TransactionLimit.objects.filter(pk=foreign.pk).exists()
        )


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
                'valueDate': '2026-09-21',
                'valueDateTime': '2026-09-21T08:00:00Z',
                'endToEndId': 'E2E-42',
                'bankTransactionCode': 'PMNT-CCRD-POSD',
                'balanceAfterTransaction': {
                    'balanceAmount': {
                        'amount': '133.38', 'currency': 'EUR',
                    },
                    'balanceType': 'InterimBooked',
                },
                'additionalDataStructured': {
                    'cardInstrument': {'cardSchemeName': 'VISA'},
                },
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
        self.assertEqual(tx.value_date.isoformat(), '2026-09-21')
        self.assertEqual(tx.value_date_time.isoformat(),
                         '2026-09-21T08:00:00+00:00')
        self.assertEqual(tx.end_to_end_id, 'E2E-42')
        self.assertEqual(tx.bank_transaction_code, 'PMNT-CCRD-POSD')
        self.assertEqual(
            tx.balance_after_transaction['balanceAmount']['amount'],
            '133.38',
        )
        self.assertEqual(
            tx.additional_data_structured['cardInstrument'],
            {'cardSchemeName': 'VISA'},
        )

    def test_maps_remittance_array_and_rules_match(self):
        category = make_category(self.user)
        make_rule(self.user, category, description='Revolut')
        self.run_command([
            {
                'transactionId': 'tx-2',
                'bookingDate': '2026-09-24',
                'transactionAmount': {
                    'amount': '-10.00', 'currency': 'EUR',
                },
                'remittanceInformationUnstructuredArray': [
                    'To Karlina', 'Sent from Revolut',
                ],
            },
        ])
        tx = Transaction.objects.get(
            account=self.account, transaction_id='tx-2'
        )
        self.assertEqual(
            tx.remittance_information,
            'To Karlina\nSent from Revolut',
        )
        self.assertEqual(
            tx.remittance_information_array,
            ['To Karlina', 'Sent from Revolut'],
        )
        assignment = UserTransactionCategory.objects.get(
            user=self.user, transaction=tx
        )
        self.assertEqual(assignment.category, category)

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

    def test_counterparty_any_scope_matches_debtor_or_creditor(self):
        rule = make_rule(self.user, self.category, sender='employer')
        incoming = make_transaction(
            self.account, 't-1', '500.00', debtor_name='Employer Ltd',
        )
        outgoing = make_transaction(
            self.account, 't-2', '-5.00', creditor_name='Employer Ltd',
        )
        self.assertTrue(rule_matches(rule, incoming))
        self.assertTrue(rule_matches(rule, outgoing))

    def test_counterparty_scope_targets_one_side(self):
        outgoing = make_transaction(
            self.account, 't-1', '-5.00', creditor_name='Shop',
        )
        incoming = make_transaction(
            self.account, 't-2', '500.00', debtor_name='Shop',
        )
        creditor_rule = make_rule(
            self.user, self.category, sender='shop', scope='creditor'
        )
        debtor_rule = make_rule(
            self.user, self.category, sender='shop', scope='debtor',
            priority=2,
        )
        self.assertTrue(rule_matches(creditor_rule, outgoing))
        self.assertFalse(rule_matches(creditor_rule, incoming))
        self.assertFalse(rule_matches(debtor_rule, outgoing))
        self.assertTrue(rule_matches(debtor_rule, incoming))

    def test_description_exclusion_vetoes_match(self):
        rule = make_rule(
            self.user, self.category,
            sender='shop', exclusion='refund',
        )
        normal = make_transaction(
            self.account, 't-1', '-5.00', creditor_name='Shop',
            remittance_information='card payment',
        )
        refund = make_transaction(
            self.account, 't-2', '-5.00', creditor_name='Shop',
            remittance_information='Refund for card payment',
        )
        self.assertTrue(rule_matches(rule, normal))
        self.assertFalse(rule_matches(rule, refund))

    def test_exclusion_only_rule_never_matches(self):
        rule = make_rule(self.user, self.category, exclusion='refund')
        tx = make_transaction(
            self.account, 't-1', '-5.00',
            remittance_information='card payment',
        )
        self.assertFalse(rule_matches(rule, tx))

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
            'counterparty_scope': 'any',
            'counterparty_pattern': '',
            'counterparty_match_type': 'contains',
            'description_pattern': 'shop',
            'description_match_type': 'contains',
            'description_exclusion': '',
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

    def test_reports_gain_and_loss_counts(self):
        gained = make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        # Stale 'Other' row — candidate would assign Groceries.
        make_assignment(self.user, gained, self.other_cat)
        lost = make_transaction(
            self.account, 't-2', '-5.00',
            remittance_information='rent',
        )
        # Stale 'Groceries' row no rule produces — would be cleared.
        make_assignment(self.user, lost, self.groceries)
        result = preview_rule(self.user, self.preview_data())
        self.assertEqual(result['gains'], 1)
        self.assertEqual(result['losses'], 1)
        self.assertEqual(result['changes_total'], 2)

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
    """Transactions API — the page is the SPA post-cutover, so
    assertions hit /api/finance/transactions/ JSON instead of
    template context."""

    API = '/api/finance'

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

    def get_transactions(self, params=None):
        response = self.client.get(
            f'{self.API}/transactions/', params or {}
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def tx_ids(self, body):
        return [t['id'] for t in body['transactions']]

    def test_shows_users_own_category(self):
        cat = make_category(self.user, 'Groceries')
        tx = make_transaction(self.account, 't-1', '-10.00')
        make_assignment(self.user, tx, cat)
        self.client.force_login(self.user)
        body = self.get_transactions()
        self.assertEqual(
            body['transactions'][0]['effective_category']['name'],
            'Groceries',
        )

    def test_category_filter_matches_effective_category(self):
        cat = make_category(self.user, 'Groceries')
        tx = make_transaction(self.account, 't-1', '-10.00')
        make_assignment(self.user, tx, cat)
        other_tx = make_transaction(self.account, 't-2', '-5.00')
        self.client.force_login(self.user)
        body = self.get_transactions({'category': str(cat.pk)})
        self.assertEqual(self.tx_ids(body), [tx.pk])
        body = self.get_transactions({'category': 'none'})
        self.assertEqual(self.tx_ids(body), [other_tx.pk])

    def test_sharer_sees_only_own_categories(self):
        AccountShare.objects.create(
            account=self.account, shared_with=self.other
        )
        owner_cat = make_category(self.user, 'OwnerCat')
        tx = make_transaction(self.account, 't-1', '-10.00')
        make_assignment(self.user, tx, owner_cat)
        self.client.force_login(self.other)
        body = self.get_transactions()
        self.assertIsNone(
            body['transactions'][0]['effective_category']
        )
        self.assertNotIn(
            'OwnerCat',
            [c['name'] for c in body['categories']],
        )

    def test_sort_by_amount(self):
        small = make_transaction(self.account, 't-1', '-5.00')
        large = make_transaction(self.account, 't-2', '-50.00')
        self.client.force_login(self.user)
        body = self.get_transactions(
            {'sort': 'amount', 'direction': 'asc'}
        )
        self.assertEqual(self.tx_ids(body), [large.pk, small.pk])

    def test_sort_by_category_name(self):
        cat_b = make_category(self.user, 'Beta')
        cat_a = make_category(self.user, 'Alpha')
        tx_b = make_transaction(self.account, 't-1', '-10.00')
        tx_a = make_transaction(self.account, 't-2', '-5.00')
        make_assignment(self.user, tx_b, cat_b)
        make_assignment(self.user, tx_a, cat_a)
        self.client.force_login(self.user)
        body = self.get_transactions(
            {'sort': 'category', 'direction': 'asc'}
        )
        self.assertEqual(self.tx_ids(body), [tx_a.pk, tx_b.pk])

    def test_creditor_filter_and_options(self):
        tx = make_transaction(
            self.account, 't-1', '-10.00', creditor_name='Rimi'
        )
        make_transaction(
            self.account, 't-2', '-5.00', creditor_name='Maxima'
        )
        self.client.force_login(self.user)
        body = self.get_transactions({'creditor': 'Rimi'})
        self.assertEqual(self.tx_ids(body), [tx.pk])
        body = self.get_transactions()
        self.assertEqual(
            set(body['counterparties']), {'Rimi', 'Maxima'}
        )

    def test_creditor_falls_back_to_debtor_name(self):
        tx = make_transaction(
            self.account, 't-1', '10.00', debtor_name='Employer'
        )
        self.client.force_login(self.user)
        body = self.get_transactions({'creditor': 'Employer'})
        self.assertEqual(self.tx_ids(body), [tx.pk])

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
        body = self.get_transactions({'q': 'rent'})
        self.assertEqual(self.tx_ids(body), [tx.pk])
        self.assertEqual(body['search_query'], 'rent')

    def test_account_options_and_selected_account(self):
        other = make_account(self.user, self.req, 'acc-2')
        self.client.force_login(self.user)
        body = self.get_transactions()
        self.assertEqual(len(body['accounts']), 2)
        body = self.get_transactions({'account': str(other.pk)})
        self.assertEqual(body['selected_account'], other.pk)

    def test_invalid_params_ignored(self):
        make_transaction(self.account, 't-1', '-10.00')
        self.client.force_login(self.user)
        body = self.get_transactions(
            {'account': 'x', 'category': 'x', 'sort': 'x'}
        )
        self.assertEqual(len(body['transactions']), 1)

    def test_pagination(self):
        for i in range(101):
            make_transaction(self.account, f't-{i}', '-1.00')
        self.client.force_login(self.user)

        body = self.get_transactions()
        self.assertEqual(len(body['transactions']), 100)
        self.assertEqual(body['page'], 1)

        body = self.get_transactions({'page': '2'})
        self.assertEqual(len(body['transactions']), 1)
        self.assertEqual(body['page'], 2)

        # Out-of-range and invalid pages fall back gracefully.
        body = self.get_transactions({'page': '999'})
        self.assertEqual(body['page'], 2)
        body = self.get_transactions({'page': 'abc'})
        self.assertEqual(body['page'], 1)


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
        response = self.client.get('/api/finance/categories/overview/')
        self.assertEqual(response.status_code, 200)
        rows = response.json()['rows']
        names = {row['category_name'] for row in rows}
        self.assertEqual(names, {'Groceries', 'Uncategorized'})
        groceries = next(
            row for row in rows if row['category_name'] == 'Groceries'
        )
        # Money serializes as a JSON string (DjangoJSONEncoder).
        self.assertEqual(groceries['spent'], '10.00')
        self.assertEqual(groceries['category_color'], '#00ff00')


class RuleViewTests(TestCase):
    """Rules API — the page is the SPA post-cutover, so assertions
    hit /api/finance/rules/* JSON endpoints."""

    API = '/api/finance'

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

    def post_json(self, path, payload=None):
        return self.client.post(
            f'{self.API}{path}',
            data=json.dumps(payload or {}),
            content_type='application/json',
        )

    def test_preview_endpoint_requires_login(self):
        response = self.post_json('/rules/preview/')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['error'], 'unauthenticated')

    def test_rules_list_returns_rule_conditions(self):
        make_rule(
            self.user, self.category,
            sender='Shop', scope='creditor', exclusion='refund',
        )
        self.client.force_login(self.user)
        response = self.client.get(f'{self.API}/rules/')
        self.assertEqual(response.status_code, 200)
        rule = response.json()['rules'][0]
        self.assertEqual(rule['counterparty_scope'], 'creditor')
        self.assertEqual(rule['counterparty_pattern'], 'Shop')
        self.assertEqual(rule['description_exclusion'], 'refund')

    def test_preview_endpoint_returns_json(self):
        self.client.force_login(self.user)
        make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        response = self.post_json(
            '/rules/preview/',
            {
                'category_id': self.category.pk,
                'priority': 1,
                'counterparty_scope': 'any',
                'counterparty_match_type': 'contains',
                'description_pattern': 'shop',
                'description_match_type': 'contains',
                'operator': 'AND',
                'is_active': True,
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['success'])
        self.assertEqual(data['changes_total'], 1)

    def test_preview_endpoint_rejects_missing_category(self):
        self.client.force_login(self.user)
        response = self.post_json(
            '/rules/preview/', {'description_pattern': 'shop'},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'bad_request')

    def test_save_rule_scoped_to_owner(self):
        rule = make_rule(self.user, self.category,
                         description='shop')
        self.client.force_login(self.other)
        response = self.post_json(
            '/rules/save/',
            {
                'rule_id': rule.pk,
                'category': self.category.pk,
                'priority': 1,
                'counterparty_scope': 'any',
                'counterparty_match_type': 'contains',
                'description_pattern': 'hijack',
                'description_match_type': 'contains',
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
        response = self.post_json(
            '/rules/save/',
            {
                'category': self.category.pk,
                'priority': 1,
                'counterparty_scope': 'any',
                'counterparty_match_type': 'contains',
                'description_pattern': 'shop',
                'description_match_type': 'contains',
                'operator': 'AND',
                'is_active': True,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])
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
        response = self.post_json(
            f'/rules/{second.pk}/move/', {'direction': 'up'},
        )
        self.assertEqual(response.status_code, 200)
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

    def test_monthly_breach_sends_push_and_sets_flag(self):
        start = timezone.now().date().replace(day=1)
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )
        make_transaction(
            self.account, 't-1', '-150.00', booking_date=start
        )

        mock_send = self.run_command()

        mock_send.assert_called_once()
        self.assertIn('month', mock_send.call_args[0][2])
        limit.refresh_from_db()
        self.assertIsNotNone(limit.alerted_monthly_at)

    def test_alert_text_localized_for_lv_user(self):
        from django_apps.models import UserSettings
        UserSettings.objects.create(user=self.user, language='lv')
        TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )
        make_transaction(self.account, 't-1', '-150.00', days_ago=1)

        mock_send = self.run_command()

        mock_send.assert_called_once()
        title, body = mock_send.call_args[0][1:3]
        self.assertEqual(title, 'Pārsniegts tēriņu limits')
        self.assertIn('pēdējās 7 dienās', body)

    def test_monthly_flag_cleared_when_threshold_removed(self):
        start = timezone.now().date().replace(day=1)
        limit = TransactionLimit.objects.create(
            account=self.account,
            user=self.user,
            limit_monthly=Decimal('100.00'),
        )
        make_transaction(
            self.account, 't-1', '-150.00', booking_date=start
        )
        self.run_command()
        limit.refresh_from_db()
        self.assertIsNotNone(limit.alerted_monthly_at)

        limit.limit_monthly = None
        limit.save()
        mock_send = self.run_command()

        mock_send.assert_not_called()
        limit.refresh_from_db()
        self.assertIsNone(limit.alerted_monthly_at)


class CheckBalanceAlertsTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)

    @staticmethod
    def fetch_result(amount='20.00', currency='EUR'):
        return {
            'acc-1': {
                'ok': True,
                'rate_limited': False,
                'balance': {
                    'balanceAmount': {
                        'amount': amount, 'currency': currency,
                    },
                    'balanceType': 'interimAvailable',
                },
                'error': None,
            },
        }

    def run_command(self, results=None, **kwargs):
        client = MagicMock()
        client.fetch_balances_parallel.return_value = (
            self.fetch_result() if results is None else results
        )
        with patch(
            'finance.management.commands'
            '.check_balance_alerts.GoCardlessClient',
            return_value=client,
        ), patch(
            'finance.management.commands'
            '.check_balance_alerts.send_limit_alert'
        ) as mock_send:
            call_command('check_balance_alerts', **kwargs)
        return mock_send, client

    def test_breach_notifies_and_sets_flag(self):
        alert = BalanceAlert.objects.create(
            user=self.user,
            account=self.account,
            threshold=Decimal('50.00'),
        )
        mock_send, _ = self.run_command()

        mock_send.assert_called_once()
        self.assertEqual(
            mock_send.call_args[0][0].pk, self.user.pk
        )
        self.assertEqual(mock_send.call_args[0][1], 'Low balance')
        self.assertIn('€20.00', mock_send.call_args[0][2])
        self.assertIn('€50.00', mock_send.call_args[0][2])
        self.assertEqual(
            mock_send.call_args[0][3], '/finance/balances/'
        )
        alert.refresh_from_db()
        self.assertIsNotNone(alert.alerted_at)
        notification = Notification.objects.get(user=self.user)
        self.assertEqual(notification.title, 'Low balance')
        self.assertIn('€20.00', notification.body)
        self.assertEqual(notification.url, '/finance/balances/')
        self.account.refresh_from_db()
        self.assertEqual(
            self.account.last_balance['balanceAmount']['amount'],
            '20.00',
        )
        self.assertIsNotNone(self.account.balance_updated_at)

    def test_above_threshold_stays_silent(self):
        alert = BalanceAlert.objects.create(
            user=self.user,
            account=self.account,
            threshold=Decimal('10.00'),
        )
        mock_send, _ = self.run_command()
        mock_send.assert_not_called()
        alert.refresh_from_db()
        self.assertIsNone(alert.alerted_at)
        self.assertFalse(Notification.objects.exists())

    def test_second_run_while_below_sends_nothing(self):
        BalanceAlert.objects.create(
            user=self.user,
            account=self.account,
            threshold=Decimal('50.00'),
        )
        self.run_command()
        mock_send, _ = self.run_command()
        mock_send.assert_not_called()
        self.assertEqual(Notification.objects.count(), 1)

    def test_breach_notification_localized_for_lv_user(self):
        from django_apps.models import UserSettings
        UserSettings.objects.create(user=self.user, language='lv')
        BalanceAlert.objects.create(
            user=self.user,
            account=self.account,
            threshold=Decimal('50.00'),
        )
        mock_send, _ = self.run_command()

        mock_send.assert_called_once()
        self.assertEqual(mock_send.call_args[0][1], 'Zems atlikums')
        self.assertIn(
            'zem tava €50.00', mock_send.call_args[0][2]
        )
        notification = Notification.objects.get(user=self.user)
        self.assertEqual(notification.title, 'Zems atlikums')
        self.assertIn('zem tava', notification.body)

    def test_recovery_clears_flag_then_realerts(self):
        alert = BalanceAlert.objects.create(
            user=self.user,
            account=self.account,
            threshold=Decimal('50.00'),
        )
        self.run_command()
        self.run_command(results=self.fetch_result('80.00'))
        alert.refresh_from_db()
        self.assertIsNone(alert.alerted_at)

        self.run_command()
        alert.refresh_from_db()
        self.assertIsNotNone(alert.alerted_at)
        self.assertEqual(Notification.objects.count(), 2)

    def test_fetch_failure_skips_alerts(self):
        alert = BalanceAlert.objects.create(
            user=self.user,
            account=self.account,
            threshold=Decimal('50.00'),
        )
        mock_send, _ = self.run_command(results={
            'acc-1': {
                'ok': False,
                'rate_limited': True,
                'balance': None,
                'error': '429 daily limit',
            },
        })
        mock_send.assert_not_called()
        alert.refresh_from_db()
        self.assertIsNone(alert.alerted_at)
        self.assertFalse(Notification.objects.exists())
        self.account.refresh_from_db()
        self.assertIsNone(self.account.last_balance)

    def test_currency_mismatch_skips_alerts(self):
        alert = BalanceAlert.objects.create(
            user=self.user,
            account=self.account,
            threshold=Decimal('50.00'),
        )
        mock_send, _ = self.run_command(
            results=self.fetch_result('20.00', currency='USD')
        )
        mock_send.assert_not_called()
        alert.refresh_from_db()
        self.assertIsNone(alert.alerted_at)
        self.assertFalse(Notification.objects.exists())

    def test_dry_run_writes_and_pushes_nothing(self):
        alert = BalanceAlert.objects.create(
            user=self.user,
            account=self.account,
            threshold=Decimal('50.00'),
        )
        mock_send, _ = self.run_command(dry_run=True)
        mock_send.assert_not_called()
        alert.refresh_from_db()
        self.assertIsNone(alert.alerted_at)
        self.assertFalse(Notification.objects.exists())
        self.account.refresh_from_db()
        self.assertIsNone(self.account.last_balance)

    def test_shared_account_fetched_once_for_two_users(self):
        other = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        AccountShare.objects.create(
            account=self.account, shared_with=other
        )
        BalanceAlert.objects.create(
            user=self.user,
            account=self.account,
            threshold=Decimal('50.00'),
        )
        BalanceAlert.objects.create(
            user=other,
            account=self.account,
            threshold=Decimal('30.00'),
        )
        mock_send, client = self.run_command()
        client.fetch_balances_parallel.assert_called_once_with(
            ['acc-1']
        )
        self.assertEqual(mock_send.call_count, 2)
        self.assertEqual(Notification.objects.count(), 2)
        self.assertTrue(
            Notification.objects.filter(user=other).exists()
        )

    def test_no_alerts_never_calls_api(self):
        _, client = self.run_command()
        client.fetch_balances_parallel.assert_not_called()

    def test_balance_without_amount_skips_alerts(self):
        BalanceAlert.objects.create(
            user=self.user,
            account=self.account,
            threshold=Decimal('50.00'),
        )
        mock_send, _ = self.run_command(results={
            'acc-1': {
                'ok': True,
                'rate_limited': False,
                'balance': {'balanceType': 'interimAvailable'},
                'error': None,
            },
        })
        mock_send.assert_not_called()
        self.assertFalse(Notification.objects.exists())


class PushSubscriptionEndpointTests(TestCase):
    """Push subscribe/unsubscribe API — /api/finance/push/*."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.other = User.objects.create_user(
            username='bob', password='pw'
        )
        self.subscribe_url = '/api/finance/push/subscribe/'
        self.unsubscribe_url = '/api/finance/push/unsubscribe/'
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
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['error'], 'unauthenticated')

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
        """A non-object JSON body is rejected by schema validation —
        the API has no 'Invalid JSON body' fallback like the old
        view did."""
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


class FetchBalancesParallelTests(TestCase):
    def make_client(self):
        return GoCardlessClient(secret_id='sid', secret_key='key')

    def test_429_flags_result_as_rate_limited(self):
        client = self.make_client()
        with patch.object(
            client,
            'fetch_account_balance',
            side_effect=GoCardlessError(429, 'rate limited'),
        ):
            results = client.fetch_balances_parallel(['acc-1'])
        self.assertFalse(results['acc-1']['ok'])
        self.assertTrue(results['acc-1']['rate_limited'])

    def test_other_errors_are_not_rate_limited(self):
        client = self.make_client()
        with patch.object(
            client,
            'fetch_account_balance',
            side_effect=GoCardlessError(500, 'boom'),
        ):
            results = client.fetch_balances_parallel(['acc-1'])
        self.assertFalse(results['acc-1']['ok'])
        self.assertFalse(results['acc-1']['rate_limited'])


class LiveBalancesViewTests(TestCase):
    """Balances API — the page is the SPA post-cutover; assertions
    hit /api/finance/balances/ JSON."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.pref = UserAccountPreference.objects.create(
            user=self.user, account=self.account
        )
        self.url = '/api/finance/balances/'
        self.client.force_login(self.user)

    def test_lists_stored_balance(self):
        self.account.last_balance = {
            'balanceAmount': {'amount': '99.00', 'currency': 'EUR'},
            'balanceType': 'interimAvailable',
        }
        self.account.balance_updated_at = timezone.now()
        self.account.save()
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        account = response.json()['accounts'][0]
        self.assertEqual(
            account['last_balance']['balanceAmount']['amount'],
            '99.00',
        )
        self.assertEqual(
            account['last_balance']['balanceType'],
            'interimAvailable',
        )
        self.assertIsNotNone(account['balance_updated_at'])

    def test_does_not_call_gocardless(self):
        with patch('finance.api.GoCardlessClient') as client_cls:
            response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        client_cls.assert_not_called()

    def test_no_stored_balance_is_null(self):
        response = self.client.get(self.url)
        account = response.json()['accounts'][0]
        self.assertIsNone(account['last_balance'])

    def test_excluded_accounts_not_listed(self):
        self.pref.included_in_balance_check = False
        self.pref.save()
        response = self.client.get(self.url)
        self.assertEqual(response.json()['accounts'], [])


class RefreshBalancesViewTests(TestCase):
    """Refresh API — /api/finance/balances/refresh/."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.pref = UserAccountPreference.objects.create(
            user=self.user, account=self.account
        )
        self.url = '/api/finance/balances/refresh/'
        self.client.force_login(self.user)

    def post_refresh(self, results):
        client = MagicMock()
        client.fetch_balances_parallel.return_value = results
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            return self.client.post(
                self.url,
                data='{}',
                content_type='application/json',
            )

    def ok_results(self, amount='123.45'):
        return {
            'acc-1': {
                'ok': True,
                'rate_limited': False,
                'balance': {
                    'balanceAmount': {
                        'amount': amount,
                        'currency': 'EUR',
                    },
                    'balanceType': 'interimAvailable',
                },
                'error': None,
            },
        }

    def rate_limited_results(self):
        return {
            'acc-1': {
                'ok': False,
                'rate_limited': True,
                'balance': None,
                'error': 'GoCardless API error 429: rate limited',
            },
        }

    def test_requires_post(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 405)

    def test_success_stores_balance(self):
        response = self.post_refresh(self.ok_results())
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])
        self.account.refresh_from_db()
        self.assertEqual(
            self.account.last_balance['balanceAmount']['amount'],
            '123.45',
        )
        self.assertIsNotNone(self.account.balance_updated_at)

    def test_success_message(self):
        response = self.post_refresh(self.ok_results())
        body = response.json()
        self.assertIn('Updated 1 balance(s)', body['message'])
        self.assertEqual(body['updated'], 1)

    def test_rate_limited_falls_back_to_stored_balance(self):
        self.account.last_balance = {
            'balanceAmount': {'amount': '99.00', 'currency': 'EUR'},
            'balanceType': 'interimAvailable',
        }
        updated_at = timezone.now()
        self.account.balance_updated_at = updated_at
        self.account.save()
        response = self.post_refresh(self.rate_limited_results())
        body = response.json()
        self.assertIn('daily API limit', body['message'])
        self.assertIn('last stored balance', body['message'])
        self.assertEqual(body['rate_limited'], 1)
        self.account.refresh_from_db()
        self.assertEqual(
            self.account.last_balance['balanceAmount']['amount'],
            '99.00',
        )
        self.assertEqual(self.account.balance_updated_at, updated_at)

    def test_no_included_accounts_warns_without_api_call(self):
        self.pref.included_in_balance_check = False
        self.pref.save()
        with patch(
            'finance.api.GoCardlessClient'
        ) as client_cls:
            response = self.client.post(
                self.url,
                data='{}',
                content_type='application/json',
            )
        client_cls.assert_not_called()
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body['success'])
        self.assertIn('No accounts are included', body['message'])
