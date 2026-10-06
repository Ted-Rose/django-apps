"""Coverage for the django-ninja layer at /api/finance/ (Stage 0 of
the React rewrite): session auth, CSRF, per-user isolation, error
mapping and the JSON mutation contracts — complements the service-
and command-level coverage in tests.py (its HTTP-layer tests were
repointed at this API in Stage 6)."""
import json
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from finance.models import (
    AccountShare,
    BalanceAlert,
    Category,
    CategoryOverviewShare,
    CategoryRule,
    Notification,
    PushSubscription,
    Requisition,
    TransactionLimit,
    UserAccountPreference,
    UserTransactionCategory,
)
from finance.services.categories import effective_category_for
from finance.services.gocardless import GoCardlessError
from finance.tests import (
    make_account,
    make_assignment,
    make_category,
    make_limit,
    make_requisition,
    make_rule,
    make_subscription,
    make_transaction,
)


class ApiTestCase(TestCase):
    API = '/api/finance'

    def post_json(self, path, payload=None):
        return self.client.post(
            f'{self.API}{path}',
            data=json.dumps(payload or {}),
            content_type='application/json',
        )


class FinanceApiAuthTests(ApiTestCase):
    """Session auth + CSRF contract shared with /api/tasks/."""

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )

    def test_get_requires_session_auth(self):
        resp = self.client.get(f'{self.API}/accounts/')
        self.assertEqual(resp.status_code, 401)
        body = resp.json()
        self.assertEqual(body['error'], 'unauthenticated')
        self.assertTrue(
            body['login_url'].startswith('/admin/login/?next=')
        )

    def test_unauthenticated_post_is_401(self):
        resp = self.client.post(
            f'{self.API}/rules/apply/',
            data='{}',
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()['error'], 'unauthenticated')

    def test_post_without_csrf_token_rejected(self):
        csrf_client = self.client.__class__(enforce_csrf_checks=True)
        csrf_client.force_login(self.user)
        resp = csrf_client.post(
            f'{self.API}/rules/apply/',
            data='{}',
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()['error'], 'forbidden')

    def test_post_with_csrf_token_allowed(self):
        csrf_client = self.client.__class__(enforce_csrf_checks=True)
        csrf_client.force_login(self.user)
        csrf_client.cookies['csrftoken'] = 'x' * 32
        resp = csrf_client.post(
            f'{self.API}/rules/apply/',
            data='{}',
            content_type='application/json',
            HTTP_X_CSRFTOKEN='x' * 32,
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])


class AccountsApiTests(ApiTestCase):
    """for_user() scoping: sharers read shared accounts but
    owner-only mutations stay owner-only."""

    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            username='alice', password='pw'
        )
        self.sharer = User.objects.create_user(
            username='bob', password='pw'
        )
        self.third = User.objects.create_user(
            username='carol', password='pw'
        )
        self.req = make_requisition(self.owner)
        self.account = make_account(self.owner, self.req)
        AccountShare.objects.create(
            account=self.account, shared_with=self.sharer
        )

    def test_sharer_reads_shared_account(self):
        self.client.force_login(self.sharer)
        resp = self.client.get(f'{self.API}/accounts/')
        self.assertEqual(resp.status_code, 200)
        accounts = resp.json()['accounts']
        self.assertEqual(len(accounts), 1)
        self.assertEqual(accounts[0]['account_id'], 'acc-1')
        self.assertFalse(accounts[0]['is_owner'])
        self.assertEqual(accounts[0]['owner_username'], 'alice')

    def test_accounts_excludes_foreign_accounts(self):
        self.client.force_login(self.third)
        resp = self.client.get(f'{self.API}/accounts/')
        self.assertEqual(resp.json()['accounts'], [])

    def test_sharer_cannot_share_onward(self):
        self.client.force_login(self.sharer)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/share/',
            {'username': 'carol'},
        )
        self.assertEqual(resp.status_code, 404)
        self.assertFalse(
            AccountShare.objects.filter(
                shared_with=self.third
            ).exists()
        )

    def test_owner_can_share(self):
        self.client.force_login(self.owner)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/share/',
            {'username': 'carol'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        self.assertEqual(
            resp.json()['message'], 'Account shared with carol.'
        )
        self.assertTrue(
            AccountShare.objects.filter(
                account=self.account, shared_with=self.third
            ).exists()
        )
        # A default preference is created for the new viewer.
        self.assertTrue(
            UserAccountPreference.objects.filter(
                user=self.third, account=self.account
            ).exists()
        )

    def test_share_unknown_username_is_400(self):
        self.client.force_login(self.owner)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/share/',
            {'username': 'nobody'},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'bad_request')
        self.assertIn('username', resp.json()['detail'])

    def test_share_self_is_400(self):
        self.client.force_login(self.owner)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/share/',
            {'username': 'alice'},
        )
        self.assertEqual(resp.status_code, 400)

    def test_sharer_toggles_own_balance_check(self):
        pref = UserAccountPreference.objects.create(
            user=self.sharer,
            account=self.account,
            included_in_balance_check=True,
        )
        self.client.force_login(self.sharer)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/toggle-balance-check/'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['included_in_balance_check'])
        pref.refresh_from_db()
        self.assertFalse(pref.included_in_balance_check)


class BalanceAlertApiTests(ApiTestCase):
    """Per-user low-balance alerts: any viewer (owner or sharer)
    keeps their own threshold on an account they can see."""

    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            username='alice', password='pw'
        )
        self.sharer = User.objects.create_user(
            username='bob', password='pw'
        )
        self.third = User.objects.create_user(
            username='carol', password='pw'
        )
        self.req = make_requisition(self.owner)
        self.account = make_account(self.owner, self.req)
        AccountShare.objects.create(
            account=self.account, shared_with=self.sharer
        )

    def test_save_creates_alert_row(self):
        self.client.force_login(self.owner)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/balance-alert/',
            {'threshold': '50.00'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.json()['message'], 'Balance alert saved.'
        )
        alert = BalanceAlert.objects.get(
            user=self.owner, account=self.account
        )
        self.assertEqual(alert.threshold, Decimal('50.00'))
        self.assertTrue(alert.is_active)

    def test_save_negative_threshold_allowed(self):
        self.client.force_login(self.owner)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/balance-alert/',
            {'threshold': '-50.00'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            BalanceAlert.objects.get(user=self.owner).threshold,
            Decimal('-50.00'),
        )

    def test_save_resets_episode_flag(self):
        alert = BalanceAlert.objects.create(
            user=self.owner,
            account=self.account,
            threshold=Decimal('10.00'),
            alerted_at=timezone.now(),
        )
        self.client.force_login(self.owner)
        self.post_json(
            f'/accounts/{self.account.pk}/balance-alert/',
            {'threshold': '20.00'},
        )
        alert.refresh_from_db()
        self.assertEqual(alert.threshold, Decimal('20.00'))
        self.assertIsNone(alert.alerted_at)

    def test_sharer_saves_own_alert(self):
        self.client.force_login(self.sharer)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/balance-alert/',
            {'threshold': '25.00'},
        )
        self.assertEqual(resp.status_code, 200)
        # Owner and sharer keep independent rows.
        self.assertEqual(
            BalanceAlert.objects.filter(
                account=self.account
            ).count(),
            1,
        )
        self.assertTrue(
            BalanceAlert.objects.filter(
                user=self.sharer, account=self.account
            ).exists()
        )

    def test_save_404_on_foreign_account(self):
        self.client.force_login(self.third)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/balance-alert/',
            {'threshold': '50.00'},
        )
        self.assertEqual(resp.status_code, 404)
        self.assertFalse(BalanceAlert.objects.exists())

    def test_delete_removes_only_callers_alert(self):
        own = BalanceAlert.objects.create(
            user=self.owner,
            account=self.account,
            threshold=Decimal('50.00'),
        )
        other = BalanceAlert.objects.create(
            user=self.sharer,
            account=self.account,
            threshold=Decimal('10.00'),
        )
        self.client.force_login(self.owner)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/balance-alert/delete/'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(
            BalanceAlert.objects.filter(pk=own.pk).exists()
        )
        self.assertTrue(
            BalanceAlert.objects.filter(pk=other.pk).exists()
        )

    def test_delete_404_on_foreign_account(self):
        self.client.force_login(self.third)
        resp = self.post_json(
            f'/accounts/{self.account.pk}/balance-alert/delete/'
        )
        self.assertEqual(resp.status_code, 404)

    def test_accounts_payload_carries_alert_and_push_config(self):
        BalanceAlert.objects.create(
            user=self.sharer,
            account=self.account,
            threshold=Decimal('75.50'),
        )
        self.client.force_login(self.sharer)
        resp = self.client.get(f'{self.API}/accounts/')
        body = resp.json()
        self.assertEqual(
            body['accounts'][0]['balance_alert'], '75.50'
        )
        push_config = body['push_config']
        self.assertEqual(push_config['subscription_count'], 0)
        self.assertEqual(
            push_config['subscribe_url'],
            '/api/finance/push/subscribe/',
        )
        # The owner's view of the same account shows no alert —
        # thresholds are per-user.
        self.client.force_login(self.owner)
        resp = self.client.get(f'{self.API}/accounts/')
        self.assertIsNone(
            resp.json()['accounts'][0]['balance_alert']
        )

    def test_balances_payload_carries_alert(self):
        UserAccountPreference.objects.create(
            user=self.owner,
            account=self.account,
            included_in_balance_check=True,
        )
        BalanceAlert.objects.create(
            user=self.owner,
            account=self.account,
            threshold=Decimal('10.00'),
        )
        self.client.force_login(self.owner)
        resp = self.client.get(f'{self.API}/balances/')
        self.assertEqual(
            resp.json()['accounts'][0]['balance_alert'], '10.00'
        )


class NotificationsApiTests(ApiTestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.other = User.objects.create_user(
            username='bob', password='pw'
        )
        self.client.force_login(self.user)

    def make_notification(self, user=None):
        return Notification.objects.create(
            user=user or self.user,
            title='Low balance',
            body='acc: €1.00',
            url='/finance/balances/',
        )

    def test_lists_only_own_unread(self):
        self.make_notification()
        self.make_notification(user=self.other)
        read = self.make_notification()
        Notification.objects.filter(pk=read.pk).update(
            read_at=timezone.now()
        )
        resp = self.client.get(f'{self.API}/notifications/')
        self.assertEqual(resp.status_code, 200)
        notifications = resp.json()['notifications']
        self.assertEqual(len(notifications), 1)
        self.assertEqual(notifications[0]['title'], 'Low balance')
        self.assertEqual(
            notifications[0]['url'], '/finance/balances/'
        )

    def test_mark_read_stamps_only_own_rows(self):
        own = self.make_notification()
        foreign = self.make_notification(user=self.other)
        resp = self.post_json(
            '/notifications/read/', {'ids': [own.pk, foreign.pk]}
        )
        self.assertEqual(resp.status_code, 200)
        own.refresh_from_db()
        foreign.refresh_from_db()
        self.assertIsNotNone(own.read_at)
        self.assertIsNone(foreign.read_at)
        resp = self.client.get(f'{self.API}/notifications/')
        self.assertEqual(resp.json()['notifications'], [])


class TransactionsApiTests(ApiTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.client.force_login(self.user)

    def test_list_returns_rows_and_option_lists(self):
        category = make_category(self.user, 'Groceries')
        tx = make_transaction(
            self.account, 't-1', '-10.00', creditor_name='Rimi'
        )
        make_assignment(self.user, tx, category)

        resp = self.client.get(f'{self.API}/transactions/')

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['count'], 1)
        self.assertEqual(body['page'], 1)
        self.assertEqual(body['num_pages'], 1)
        self.assertFalse(body['filters_active'])
        row = body['transactions'][0]
        self.assertEqual(row['transaction_id'], 't-1')
        self.assertEqual(row['counterparty'], 'Rimi')
        self.assertEqual(row['amount'], '-10.00')
        self.assertEqual(
            row['effective_category']['name'], 'Groceries'
        )
        self.assertEqual(row['account']['id'], self.account.pk)
        self.assertEqual(
            body['accounts'][0]['id'], self.account.pk
        )
        self.assertEqual(body['counterparties'], ['Rimi'])
        # 'Excluded' is auto-provisioned for every user — look the
        # created category up by name rather than position.
        categories = {c['name']: c for c in body['categories']}
        self.assertEqual(
            categories['Groceries']['id'], category.pk
        )

    def test_filters_sort_and_search(self):
        make_transaction(
            self.account, 't-1', '-5.00', creditor_name='Rimi',
            remittance_information='groceries',
        )
        make_transaction(
            self.account, 't-2', '-50.00', creditor_name='Maxima',
            remittance_information='rent',
        )

        resp = self.client.get(
            f'{self.API}/transactions/?creditor=Rimi'
        )
        body = resp.json()
        self.assertEqual(
            [t['transaction_id'] for t in body['transactions']],
            ['t-1'],
        )
        self.assertTrue(body['filters_active'])

        resp = self.client.get(
            f'{self.API}/transactions/?q=rent&sort=amount'
            '&direction=asc'
        )
        body = resp.json()
        self.assertEqual(
            [t['transaction_id'] for t in body['transactions']],
            ['t-2'],
        )
        self.assertEqual(body['sort'], 'amount')
        self.assertEqual(body['direction'], 'asc')

        resp = self.client.get(
            f'{self.API}/transactions/?category=none'
        )
        self.assertEqual(resp.json()['count'], 2)

    def test_date_window_filters_by_occurrence_date(self):
        make_transaction(self.account, 't-old', '-1.00', days_ago=40)
        make_transaction(self.account, 't-mid', '-2.00', days_ago=10)
        make_transaction(self.account, 't-new', '-3.00', days_ago=1)
        today = timezone.now().date()
        date_from = (today - timezone.timedelta(days=15)).isoformat()
        date_to = (today - timezone.timedelta(days=5)).isoformat()

        resp = self.client.get(
            f'{self.API}/transactions/?from={date_from}&to={date_to}'
        )
        body = resp.json()
        self.assertEqual(
            [t['transaction_id'] for t in body['transactions']],
            ['t-mid'],
        )
        self.assertTrue(body['filters_active'])

        # A single bound still filters; unparseable dates are
        # ignored like the other invalid params.
        resp = self.client.get(
            f'{self.API}/transactions/?from={date_from}'
        )
        self.assertEqual(resp.json()['count'], 2)
        resp = self.client.get(
            f'{self.API}/transactions/?from=not-a-date'
        )
        self.assertEqual(resp.json()['count'], 3)

    def test_occurrence_date_prefers_earlier_value_date(self):
        """A card purchase valued Sep 30 but booked Oct 1 belongs to
        September — Swedbank posts days after the valueDate."""
        make_transaction(
            self.account, 't-1', '-3.76',
            booking_date=date(2026, 10, 1),
            value_date=date(2026, 9, 30),
        )
        make_transaction(
            self.account, 't-2', '-1.00',
            booking_date=date(2026, 10, 2),
        )
        resp = self.client.get(
            f'{self.API}/transactions/?from=2026-10-01'
        )
        body = resp.json()
        self.assertEqual(
            [t['transaction_id'] for t in body['transactions']],
            ['t-2'],
        )
        self.assertEqual(
            body['transactions'][0]['occurrence_date'], '2026-10-02'
        )

    def test_foreign_transactions_hidden(self):
        other = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        req = make_requisition(other, 'req-b')
        foreign = make_account(other, req, 'acc-b')
        make_transaction(foreign, 't-x', '-9.00')
        resp = self.client.get(f'{self.API}/transactions/')
        self.assertEqual(resp.json()['count'], 0)

    def test_account_filter_accepts_comma_list(self):
        """?account=1,2 scopes to several accounts — the limits
        drill-down passes the whole account set of a limit."""
        second = make_account(self.user, self.req, 'acc-2')
        third = make_account(self.user, self.req, 'acc-3')
        make_transaction(self.account, 't-1', '-1.00')
        make_transaction(second, 't-2', '-2.00')
        make_transaction(third, 't-3', '-3.00')

        resp = self.client.get(
            f'{self.API}/transactions/'
            f'?account={self.account.pk},{second.pk}'
        )
        body = resp.json()
        self.assertEqual(
            sorted(
                t['transaction_id'] for t in body['transactions']
            ),
            ['t-1', 't-2'],
        )
        # A multi-account selection can't map to one dropdown value.
        self.assertIsNone(body['selected_account'])
        self.assertTrue(body['filters_active'])

        # Blank segments are skipped; an all-invalid list leaves
        # the queryset unfiltered like a bad single value did.
        resp = self.client.get(
            f'{self.API}/transactions/?account=x,,'
        )
        self.assertEqual(resp.json()['count'], 3)


class ManualCategoryApiTests(ApiTestCase):
    """The assign/clear endpoints write per-user is_manual rows and
    `?source=manual` filters the list to overridden transactions."""

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
        self.tx = make_transaction(self.account, 't-1', '-10.00')
        self.client.force_login(self.user)

    def test_assign_contract_and_flag_in_payload(self):
        resp = self.post_json(
            f'/transactions/{self.tx.pk}/category/',
            {'category': self.category.pk},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        self.assertEqual(
            resp.json()['message'], 'Category "Groceries" assigned.'
        )
        self.assertEqual(resp.json()['code'], 'categoryAssigned')
        self.assertEqual(
            resp.json()['params'], {'name': 'Groceries'}
        )

        resp = self.client.get(f'{self.API}/transactions/')
        row = resp.json()['transactions'][0]
        self.assertEqual(row['category_is_manual'], True)
        self.assertEqual(
            row['effective_category']['name'], 'Groceries'
        )

    def test_clear_contract(self):
        make_assignment(
            self.user, self.tx, self.category, is_manual=True
        )
        resp = self.post_json(
            f'/transactions/{self.tx.pk}/category/clear/'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        self.assertEqual(
            resp.json()['message'],
            'Reverted to automatic categorization.',
        )
        self.assertEqual(resp.json()['code'], 'categoryReverted')

        resp = self.client.get(f'{self.API}/transactions/')
        row = resp.json()['transactions'][0]
        self.assertFalse(row['category_is_manual'] or False)

    def test_assign_404_on_foreign_transaction(self):
        req = make_requisition(self.other, 'req-b')
        foreign = make_account(self.other, req, 'acc-b')
        tx = make_transaction(foreign, 't-x', '-9.00')
        resp = self.post_json(
            f'/transactions/{tx.pk}/category/',
            {'category': self.category.pk},
        )
        self.assertEqual(resp.status_code, 404)
        resp = self.post_json(
            f'/transactions/{tx.pk}/category/clear/'
        )
        self.assertEqual(resp.status_code, 404)

    def test_assign_404_on_foreign_category(self):
        foreign_cat = make_category(self.other, 'Foreign')
        resp = self.post_json(
            f'/transactions/{self.tx.pk}/category/',
            {'category': foreign_cat.pk},
        )
        self.assertEqual(resp.status_code, 404)
        self.assertFalse(
            UserTransactionCategory.objects.exists()
        )

    def test_sharer_overrides_without_touching_owners_row(self):
        AccountShare.objects.create(
            account=self.account, shared_with=self.other
        )
        make_assignment(
            self.user, self.tx, self.category, is_manual=True
        )
        sharer_cat = make_category(self.other, 'SharerCat')
        self.client.force_login(self.other)
        resp = self.post_json(
            f'/transactions/{self.tx.pk}/category/',
            {'category': sharer_cat.pk},
        )
        self.assertEqual(resp.status_code, 200)
        owner_row = UserTransactionCategory.objects.get(
            user=self.user, transaction=self.tx
        )
        self.assertEqual(owner_row.category, self.category)

    def test_source_manual_filter(self):
        make_assignment(
            self.user, self.tx, self.category, is_manual=True
        )
        auto_tx = make_transaction(self.account, 't-2', '-5.00')
        make_assignment(self.user, auto_tx, self.category)
        make_transaction(self.account, 't-3', '-1.00')

        resp = self.client.get(
            f'{self.API}/transactions/?source=manual'
        )
        body = resp.json()
        self.assertEqual(
            [t['transaction_id'] for t in body['transactions']],
            ['t-1'],
        )
        self.assertEqual(body['selected_source'], 'manual')
        self.assertTrue(body['filters_active'])

        # Unknown source values are ignored, not 400s.
        resp = self.client.get(
            f'{self.API}/transactions/?source=bogus'
        )
        body = resp.json()
        self.assertEqual(body['count'], 3)
        self.assertEqual(body['selected_source'], '')


class LimitsApiTests(ApiTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.client.force_login(self.user)

    def test_limits_get_includes_push_config(self):
        make_limit(
            account=self.account,
            user=self.user,
            limit_7_days=Decimal('100.00'),
        )
        resp = self.client.get(f'{self.API}/limits/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(len(body['limits']), 1)
        limit = body['limits'][0]
        self.assertEqual(limit['limit_7_days'], '100.00')
        self.assertEqual(
            limit['window_stats'][0]['label'], '7 days'
        )
        self.assertIn('history', limit['window_stats'][0] or {})
        # Each window stat carries its booking-date range — the
        # SPA drill-down feeds it back as ?from=/&to=.
        today = timezone.now().date()
        self.assertEqual(
            limit['window_stats'][0]['date_from'],
            (today - timezone.timedelta(days=7)).isoformat(),
        )
        self.assertEqual(
            limit['window_stats'][0]['date_to'], today.isoformat()
        )
        push_config = body['push_config']
        self.assertEqual(push_config['subscription_count'], 0)
        self.assertEqual(
            push_config['subscribe_url'],
            '/api/finance/push/subscribe/',
        )
        self.assertEqual(
            push_config['unsubscribe_url'],
            '/api/finance/push/unsubscribe/',
        )
        # Option lists for the limit form ship in the same response.
        self.assertEqual(
            body['accounts'][0]['id'], self.account.pk
        )

    def test_save_limit_creates_row(self):
        resp = self.post_json('/limits/save/', {
            'accounts': [self.account.pk],
            'limit_7_days': '100.00',
            'is_active': True,
        })
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        self.assertEqual(
            resp.json()['message'], 'Spending limit saved.'
        )
        limit = TransactionLimit.objects.get(
            accounts=self.account, user=self.user
        )
        self.assertEqual(limit.limit_7_days, Decimal('100.00'))

    def test_save_limit_rejects_other_users_account(self):
        other = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        foreign = make_account(other, self.req, 'acc-b')
        resp = self.post_json('/limits/save/', {
            'accounts': [foreign.pk],
            'limit_7_days': '100.00',
        })
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(
            TransactionLimit.objects.filter(
                accounts=foreign
            ).exists()
        )

    def test_save_limit_edit_conflict_is_409(self):
        cat_a = make_category(self.user, 'A')
        cat_b = make_category(self.user, 'B')
        make_limit(
            account=self.account,
            user=self.user,
            category=cat_a,
            limit_7_days=Decimal('10.00'),
        )
        second = make_limit(
            account=self.account,
            user=self.user,
            category=cat_b,
            limit_7_days=Decimal('20.00'),
        )
        # Editing `second` to collide on (accounts, user, category)
        # hits the overlap check → 409.
        resp = self.post_json('/limits/save/', {
            'limit_id': second.pk,
            'accounts': [self.account.pk],
            'category': cat_a.pk,
            'limit_7_days': '30.00',
            'is_active': True,
        })
        self.assertEqual(resp.status_code, 409)
        body = resp.json()
        self.assertEqual(body['error'], 'conflict')
        self.assertIn('already exists', body['detail'])

    def test_delete_limit_scoped_to_user(self):
        other = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        foreign = make_limit(
            account=self.account,
            user=other,
            limit_7_days=Decimal('100.00'),
        )
        resp = self.post_json(f'/limits/{foreign.pk}/delete/')
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(
            TransactionLimit.objects.filter(pk=foreign.pk).exists()
        )


class RulesApiTests(ApiTestCase):
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
        self.client.force_login(self.user)

    def rule_payload(self, **overrides):
        payload = {
            'category': self.category.pk,
            'priority': 1,
            'counterparty_scope': 'any',
            'counterparty_pattern': '',
            'counterparty_match_type': 'contains',
            'description_pattern': 'shop',
            'description_match_type': 'contains',
            'description_exclusion': '',
            'operator': 'AND',
            'is_active': True,
        }
        payload.update(overrides)
        return payload

    def test_rules_get_lists_rules_and_choices(self):
        make_rule(self.user, self.category, description='shop')
        resp = self.client.get(f'{self.API}/rules/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(len(body['rules']), 1)
        self.assertEqual(
            body['rules'][0]['description_pattern'], 'shop'
        )
        self.assertIn(
            'Groceries',
            [c['name'] for c in body['categories']],
        )
        self.assertEqual(
            body['match_types'][0],
            {'value': 'contains', 'label': 'Contains'},
        )
        self.assertEqual(
            body['operators'], [
                {'value': 'AND', 'label': 'AND'},
                {'value': 'OR', 'label': 'OR'},
            ]
        )

    def test_preview_returns_preview_dict(self):
        make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop run',
        )
        resp = self.post_json('/rules/preview/', {
            'category_id': self.category.pk,
            'priority': 1,
            'description_pattern': 'shop',
            'is_active': True,
        })
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['match_count'], 1)
        self.assertEqual(body['apply_count'], 1)
        self.assertEqual(body['changes_total'], 1)
        self.assertEqual(
            body['changes'][0]['new_category'], 'Groceries'
        )

    def test_preview_missing_category_is_400(self):
        resp = self.post_json(
            '/rules/preview/', {'description_pattern': 'shop'}
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'bad_request')

    def test_save_rule_creates_and_applies(self):
        tx = make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        resp = self.post_json('/rules/save/', self.rule_payload())
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['changed'], 1)
        self.assertIn('Rule saved', body['message'])
        self.assertEqual(
            effective_category_for(tx, self.user), self.category
        )

    def test_save_rule_form_errors_are_400(self):
        resp = self.post_json('/rules/save/', {
            'category': self.category.pk,
            'priority': 1,
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Could not save rule', resp.json()['detail'])

    def test_save_rule_scoped_to_owner(self):
        rule = make_rule(
            self.user, self.category, description='shop'
        )
        self.client.force_login(self.other)
        resp = self.post_json('/rules/save/', self.rule_payload(
            rule_id=rule.pk, description_pattern='hijack',
        ))
        self.assertEqual(resp.status_code, 404)
        rule.refresh_from_db()
        self.assertEqual(rule.description_pattern, 'shop')

    def test_move_rule_swaps_priority(self):
        other_cat = make_category(self.user, 'Other')
        first = make_rule(
            self.user, self.category, priority=1, description='a'
        )
        second = make_rule(
            self.user, other_cat, priority=2, description='b'
        )
        resp = self.post_json(
            f'/rules/{second.pk}/move/', {'direction': 'up'}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((second.priority, first.priority), (1, 2))

    def test_apply_rules_reports_changed(self):
        make_rule(self.user, self.category, description='shop')
        make_transaction(
            self.account, 't-1', '-10.00',
            remittance_information='shop',
        )
        resp = self.post_json('/rules/apply/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['changed'], 1)
        self.assertEqual(
            body['message'], '1 transaction(s) recategorized.'
        )

    def test_category_save_and_delete(self):
        resp = self.post_json('/categories/save/', {
            'name': 'Travel', 'color': '#00ff00',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.json()['message'], 'Category "Travel" saved.'
        )
        category = Category.objects.get(user=self.user, name='Travel')
        self.assertEqual(category.color, '#00ff00')

        resp = self.post_json(
            f'/categories/{category.pk}/delete/'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(
            Category.objects.filter(pk=category.pk).exists()
        )

    def test_category_save_requires_name(self):
        resp = self.post_json('/categories/save/', {'name': '  '})
        self.assertEqual(resp.status_code, 400)


class PushApiTests(ApiTestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.other = User.objects.create_user(
            username='bob', password='pw'
        )
        self.payload = {
            'endpoint': 'https://push.example.com/sub/1',
            'keys': {'p256dh': 'key', 'auth': 'secret'},
        }
        self.client.force_login(self.user)

    @override_settings(VAPID_PUBLIC_KEY='pub')
    def test_subscribe_creates_and_updates_row(self):
        resp = self.post_json('/push/subscribe/', self.payload)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        sub = PushSubscription.objects.get(user=self.user)
        self.assertEqual(sub.p256dh, 'key')

        updated = dict(self.payload)
        updated['keys'] = {'p256dh': 'key2', 'auth': 'secret2'}
        resp = self.post_json('/push/subscribe/', updated)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(PushSubscription.objects.count(), 1)
        sub.refresh_from_db()
        self.assertEqual(sub.p256dh, 'key2')

    @override_settings(VAPID_PUBLIC_KEY='pub')
    def test_subscribe_400_on_bad_endpoint(self):
        bad_endpoints = (
            'http://insecure.example.com/sub/1',
            '',
            'https://' + 'x' * 600,
        )
        for endpoint in bad_endpoints:
            resp = self.post_json('/push/subscribe/', {
                'endpoint': endpoint,
                'keys': {'p256dh': 'k', 'auth': 'a'},
            })
            self.assertEqual(resp.status_code, 400)
        self.assertFalse(PushSubscription.objects.exists())

    @override_settings(VAPID_PUBLIC_KEY='pub')
    def test_subscribe_400_on_missing_keys(self):
        resp = self.post_json('/push/subscribe/', {
            'endpoint': 'https://push.example.com/sub/1',
        })
        self.assertEqual(resp.status_code, 400)
        resp = self.post_json('/push/subscribe/', {
            'endpoint': 'https://push.example.com/sub/1',
            'keys': {},
        })
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(PushSubscription.objects.exists())

    @override_settings(VAPID_PUBLIC_KEY='')
    def test_subscribe_400_when_vapid_unconfigured(self):
        resp = self.post_json('/push/subscribe/', self.payload)
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(PushSubscription.objects.exists())

    def test_unsubscribe_deletes_own_row(self):
        sub = make_subscription(
            self.user, self.payload['endpoint']
        )
        resp = self.post_json(
            '/push/unsubscribe/', {'endpoint': sub.endpoint}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(PushSubscription.objects.exists())

    def test_unsubscribe_404_for_foreign_endpoint(self):
        sub = make_subscription(
            self.other, self.payload['endpoint']
        )
        resp = self.post_json(
            '/push/unsubscribe/', {'endpoint': sub.endpoint}
        )
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(PushSubscription.objects.exists())


class ConnectApiTests(ApiTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )
        self.client.force_login(self.user)

    def test_connect_returns_link_and_writes_session(self):
        client = MagicMock()
        client.create_requisition.return_value = {
            'id': 'req-42',
            'status': 'CR',
            'link': 'https://bank.example.com/auth',
        }
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            resp = self.post_json(
                '/connect/', {'institution_id': 'BANK'}
            )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['link'], 'https://bank.example.com/auth')
        self.assertEqual(body['requisition_id'], 'req-42')
        self.assertEqual(
            self.client.session['requisition_id'], 'req-42'
        )
        self.assertTrue(
            Requisition.objects.filter(
                requisition_id='req-42', user=self.user
            ).exists()
        )

    def test_connect_gocardless_error_is_502(self):
        client = MagicMock()
        client.create_requisition.side_effect = GoCardlessError(
            400, 'bad request'
        )
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            resp = self.post_json(
                '/connect/', {'institution_id': 'BANK'}
            )
        self.assertEqual(resp.status_code, 502)
        body = resp.json()
        self.assertEqual(body['error'], 'upstream_error')
        self.assertIn('Could not start bank link', body['detail'])

    def test_institutions_list(self):
        client = MagicMock()
        client.list_institutions.return_value = [
            {
                'id': 'BANK_LV',
                'name': 'Test Bank',
                'bic': 'BANKL22',
                'logo': 'https://example.com/logo.png',
                'countries': ['LV'],
                'transaction_total_days': '90',
            },
        ]
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            resp = self.client.get(
                f'{self.API}/institutions/?country=lv'
            )
        self.assertEqual(resp.status_code, 200)
        institutions = resp.json()['institutions']
        self.assertEqual(institutions[0]['id'], 'BANK_LV')
        self.assertEqual(institutions[0]['name'], 'Test Bank')
        client.list_institutions.assert_called_once_with('lv')

    def test_institutions_gocardless_error_is_502(self):
        client = MagicMock()
        client.list_institutions.side_effect = GoCardlessError(
            503, 'down'
        )
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            resp = self.client.get(
                f'{self.API}/institutions/?country=lv'
            )
        self.assertEqual(resp.status_code, 502)
        self.assertEqual(resp.json()['error'], 'upstream_error')

    def test_institutions_without_country_is_empty(self):
        resp = self.client.get(f'{self.API}/institutions/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['institutions'], [])


class SyncAndBalancesApiTests(ApiTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.client.force_login(self.user)

    def test_sync_without_linked_accounts(self):
        self.req.status = 'CR'
        self.req.save()
        resp = self.post_json('/transactions/sync/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertFalse(body['success'])
        self.assertEqual(
            body['message'], 'No linked bank accounts to sync.'
        )
        self.assertEqual(len(body['accounts']), 1)
        self.assertEqual(body['accounts'][0]['status'], 'skipped')
        self.assertIn('CR', body['accounts'][0]['detail'])

    def test_sync_accepts_missing_body(self):
        """The SPA posts no body when no account filter is set —
        fetch sends neither Content-Type nor a body."""
        self.req.status = 'CR'
        self.req.save()
        resp = self.client.generic(
            'POST', f'{self.API}/transactions/sync/'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['success'])

    def test_sync_reports_counts(self):
        client = MagicMock()
        client.fetch_transactions.return_value = {
            'booked': [
                {
                    'transactionId': 'tx-1',
                    'bookingDate': '2026-09-20',
                    'transactionAmount': {
                        'amount': '-12.34', 'currency': 'EUR',
                    },
                },
            ],
        }
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            resp = self.post_json('/transactions/sync/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['created'], 1)
        self.assertEqual(body['failed'], 0)
        self.assertIn('Synced 1 new transactions', body['message'])
        self.assertEqual(len(body['accounts']), 1)
        self.assertEqual(body['accounts'][0]['status'], 'synced')
        self.assertEqual(body['accounts'][0]['created'], 1)

    def test_sync_itemizes_synced_failed_and_skipped_accounts(self):
        """Per-account results make 'fetched but empty'
        distinguishable from skipped (non-LN requisition) and
        failed (upstream error) — the diagnosis surface for
        'sync only fetched one account'."""
        client = MagicMock()

        def fetch(account_id, date_from=None):
            if account_id == 'acc-2':
                raise GoCardlessError(429, 'rate limited')
            return {'booked': []}

        client.fetch_transactions.side_effect = fetch
        make_account(self.user, self.req, account_id='acc-2')
        stale_req = make_requisition(
            self.user, requisition_id='req-stale', status='EX'
        )
        make_account(self.user, stale_req, account_id='acc-3')
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            resp = self.post_json('/transactions/sync/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertFalse(body['success'])
        self.assertEqual(body['failed'], 1)
        by_status = {
            a['status']: a['account'] for a in body['accounts']
        }
        self.assertEqual(by_status['synced'], 'acc-1', body)
        self.assertEqual(by_status['failed'], 'acc-2', body)
        self.assertEqual(by_status['skipped'], 'acc-3', body)
        detail = {
            a['account']: a['detail'] for a in body['accounts']
        }
        self.assertIn('429', detail['acc-2'])
        self.assertIn('EX', detail['acc-3'])

    def test_refresh_balances_without_included_accounts(self):
        resp = self.post_json('/balances/refresh/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertFalse(body['success'])
        self.assertIn('No accounts are included', body['message'])

    def test_refresh_balances_stores_balance(self):
        UserAccountPreference.objects.create(
            user=self.user, account=self.account
        )
        client = MagicMock()
        client.fetch_balances_parallel.return_value = {
            'acc-1': {
                'ok': True,
                'rate_limited': False,
                'balance': {
                    'balanceAmount': {
                        'amount': '123.45', 'currency': 'EUR',
                    },
                    'balanceType': 'interimAvailable',
                },
                'error': None,
            },
        }
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            resp = self.post_json('/balances/refresh/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['updated'], 1)
        self.assertIn('Updated 1 balance(s)', body['message'])
        self.account.refresh_from_db()
        self.assertEqual(
            self.account.last_balance['balanceAmount']['amount'],
            '123.45',
        )

    def test_balances_lists_included_accounts(self):
        UserAccountPreference.objects.create(
            user=self.user,
            account=self.account,
            included_in_balance_check=True,
        )
        resp = self.client.get(f'{self.API}/balances/')
        self.assertEqual(resp.status_code, 200)
        accounts = resp.json()['accounts']
        self.assertEqual(len(accounts), 1)
        self.assertTrue(accounts[0]['included_in_balance_check'])


class SpaMountTests(ApiTestCase):
    """Stage 6 cutover: the SPA owns /finance/* — named shell routes
    keep reverse('finance:…') working, /finance/app/* 301s to the
    real routes, and retired form-POST URLs 404. Also covers the
    shared react_app/app_redirect regression surface — the /tasks/
    cutover must be unchanged."""

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )

    def test_named_page_routes_resolve(self):
        """reverse('finance:…') stays alive for home.html,
        evaluate_spending_limits and the callback redirects."""
        self.assertEqual(reverse('finance:index'), '/finance/')
        self.assertEqual(reverse('finance:connect'), '/finance/connect/')
        self.assertEqual(
            reverse('finance:accounts'), '/finance/accounts/'
        )
        self.assertEqual(
            reverse('finance:transactions'), '/finance/transactions/'
        )
        self.assertEqual(
            reverse('finance:balances'), '/finance/balances/'
        )
        self.assertEqual(reverse('finance:limits'), '/finance/limits/')
        self.assertEqual(reverse('finance:rules'), '/finance/rules/')
        self.assertEqual(
            reverse('finance:categories'), '/finance/categories/'
        )
        self.assertEqual(
            reverse('finance:callback'), '/finance/callback/'
        )

    def test_shell_requires_login(self):
        resp = self.client.get('/finance/')
        self.assertEqual(resp.status_code, 302)
        self.assertTrue(
            resp['Location'].startswith('/login/?next=')
        )

    def test_shell_get_renders(self):
        self.client.force_login(self.user)
        resp = self.client.get('/finance/')
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, 'Finance - Tedis')
        # Whether or not frontend_dist/manifest.json exists in this
        # environment, the shell renders the bootstrap payload —
        # a missing manifest degrades to the diagnostic warning,
        # not a 500.
        self.assertContains(resp, 'spa-bootstrap')

    def test_named_page_serves_shell(self):
        self.client.force_login(self.user)
        resp = self.client.get(reverse('finance:accounts'))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, 'spa-bootstrap')

    def test_deep_link_renders_shell(self):
        self.client.force_login(self.user)
        resp = self.client.get('/finance/transactions')
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, 'spa-bootstrap')

    def test_post_to_page_routes_is_404(self):
        # The shell is GET/HEAD-only — the retired form-POST URLs
        # (rules/save/, push/subscribe/, transactions/sync/) must
        # not answer with the HTML page.
        self.client.force_login(self.user)
        for url in (
            '/finance/',
            '/finance/accounts/',
            '/finance/rules/save/',
            '/finance/push/subscribe/',
            '/finance/transactions/sync/',
        ):
            resp = self.client.post(
                url, data='{}', content_type='application/json'
            )
            self.assertEqual(resp.status_code, 404, url)

    def test_legacy_app_paths_301(self):
        for source, target in (
            ('/finance/app', '/finance/'),
            ('/finance/app/', '/finance/'),
            ('/finance/app/rules', '/finance/rules'),
            ('/finance/app/transactions/', '/finance/transactions/'),
        ):
            resp = self.client.get(source)
            self.assertEqual(resp.status_code, 301, source)
            self.assertEqual(resp['Location'], target, source)

    def test_legacy_app_redirect_keeps_query(self):
        resp = self.client.get('/finance/app/limits?month=2026-01')
        self.assertEqual(resp.status_code, 301)
        self.assertEqual(
            resp['Location'], '/finance/limits?month=2026-01'
        )

    def test_tasks_dashboard_still_resolves(self):
        self.assertEqual(
            reverse('google_tasks:dashboard'), '/tasks/'
        )
        self.client.force_login(self.user)
        resp = self.client.get('/tasks/')
        self.assertEqual(resp.status_code, 200)

    def test_tasks_app_still_301s(self):
        resp = self.client.get('/tasks/app/x')
        self.assertEqual(resp.status_code, 301)
        self.assertEqual(resp['Location'], '/tasks/x')

        resp = self.client.get('/tasks/app/starred/')
        self.assertEqual(resp.status_code, 301)
        self.assertEqual(resp['Location'], '/tasks/starred/')


class CodeContractTests(ApiTestCase):
    """Mutation responses carry a stable `code` (plus `params`
    where the message interpolates values): the SPA translates
    `code` through its server catalog while `message`/`detail`
    stay the English fallback."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.req = make_requisition(self.user)
        self.account = make_account(self.user, self.req)
        self.client.force_login(self.user)

    def test_share_unknown_username(self):
        resp = self.post_json(
            f'/accounts/{self.account.pk}/share/',
            {'username': 'nobody'},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['code'], 'unknownUsername')

    def test_share_blank_username(self):
        resp = self.post_json(
            f'/accounts/{self.account.pk}/share/',
            {'username': ' '},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['code'], 'provideUsername')

    def test_share_success_params(self):
        get_user_model().objects.create_user(
            username='carol', password='pw'
        )
        resp = self.post_json(
            f'/accounts/{self.account.pk}/share/',
            {'username': 'carol'},
        )
        body = resp.json()
        self.assertEqual(body['code'], 'accountShared')
        self.assertEqual(body['params'], {'username': 'carol'})

    def test_balance_alert_codes(self):
        resp = self.post_json(
            f'/accounts/{self.account.pk}/balance-alert/',
            {'threshold': '10.00'},
        )
        self.assertEqual(resp.json()['code'], 'balanceAlertSaved')
        resp = self.post_json(
            f'/accounts/{self.account.pk}/balance-alert/delete/'
        )
        self.assertEqual(resp.json()['code'], 'balanceAlertRemoved')

    def test_sync_no_linked_accounts(self):
        self.req.status = 'CR'
        self.req.save()
        body = self.post_json('/transactions/sync/').json()
        self.assertEqual(body['code'], 'noLinkedAccounts')
        self.assertEqual(
            body['accounts'][0]['code'], 'requisitionNotLinked'
        )
        self.assertEqual(
            body['accounts'][0]['params'], {'status': 'CR'}
        )

    def test_sync_counts_params(self):
        client = MagicMock()
        client.fetch_transactions.return_value = {'booked': []}
        with patch(
            'finance.api.GoCardlessClient', return_value=client
        ):
            body = self.post_json('/transactions/sync/').json()
        self.assertEqual(body['code'], 'synced')
        self.assertEqual(
            body['params'],
            {'created': 0, 'updated': 0, 'failed': 0},
        )

    def test_limit_save_validation_error(self):
        # An account outside the caller's queryset fails the form —
        # schema-clean input that still produces a 400 + code.
        other = get_user_model().objects.create_user(
            username='bob', password='pw'
        )
        foreign = make_account(other, self.req, 'acc-b')
        resp = self.post_json('/limits/save/', {
            'accounts': [foreign.pk],
            'limit_7_days': '100.00',
        })
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['code'], 'couldNotSaveLimit')

    def test_limit_edit_conflict(self):
        cat_a = make_category(self.user, 'A')
        cat_b = make_category(self.user, 'B')
        make_limit(
            account=self.account, user=self.user, category=cat_a,
            limit_7_days=Decimal('10.00'),
        )
        second = make_limit(
            account=self.account, user=self.user, category=cat_b,
            limit_7_days=Decimal('20.00'),
        )
        resp = self.post_json('/limits/save/', {
            'limit_id': second.pk,
            'accounts': [self.account.pk],
            'category': cat_a.pk,
            'limit_7_days': '30.00',
        })
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['code'], 'limitConflict')

    def test_limit_saved_code(self):
        resp = self.post_json('/limits/save/', {
            'accounts': [self.account.pk],
            'limit_7_days': '100.00',
            'is_active': True,
        })
        self.assertEqual(resp.json()['code'], 'limitSaved')

    def test_rule_preview_missing_category(self):
        resp = self.post_json(
            '/rules/preview/', {'description_pattern': 'shop'}
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['code'], 'pickCategory')

    def test_category_save_empty_name(self):
        resp = self.post_json('/categories/save/', {'name': '  '})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['code'], 'categoryNameRequired')

    def test_category_save_success(self):
        resp = self.post_json('/categories/save/', {
            'name': 'Food', 'color': '#aabbcc',
        })
        body = resp.json()
        self.assertEqual(body['code'], 'categorySaved')
        self.assertEqual(body['params'], {'name': 'Food'})

    def test_push_unsubscribe_missing(self):
        resp = self.post_json('/push/unsubscribe/', {
            'endpoint': 'https://push.example/x',
        })
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()['code'], 'subscriptionNotFound')


class ExclusionApiTests(ApiTestCase):
    """POST /transactions/<id>/exclusion/ — the caller's per-
    transaction excluded amount (the part that doesn't count)."""

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
        self.tx = make_transaction(self.account, 't-1', '-100.00')
        self.client.force_login(self.user)

    def assignment(self):
        return UserTransactionCategory.objects.filter(
            user=self.user, transaction=self.tx
        ).first()

    def test_set_exclusion_marks_manual_keeps_category(self):
        make_assignment(self.user, self.tx, self.category)
        resp = self.post_json(
            f'/transactions/{self.tx.pk}/exclusion/',
            {'excluded_amount': '40.00'},
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['code'], 'exclusionSaved')
        self.assertEqual(
            body['params'],
            {'amount': '40.00', 'currency': 'EUR'},
        )
        row = self.assignment()
        self.assertTrue(row.is_manual)
        self.assertEqual(row.excluded_amount, Decimal('40.00'))
        self.assertEqual(row.category, self.category)

    def test_exclusion_creates_manual_row_on_fresh_tx(self):
        resp = self.post_json(
            f'/transactions/{self.tx.pk}/exclusion/',
            {'excluded_amount': '25.00'},
        )
        self.assertEqual(resp.status_code, 200)
        row = self.assignment()
        self.assertTrue(row.is_manual)
        self.assertIsNone(row.category)
        self.assertEqual(row.excluded_amount, Decimal('25.00'))

    def test_zero_clears_the_exclusion(self):
        self.post_json(
            f'/transactions/{self.tx.pk}/exclusion/',
            {'excluded_amount': '40.00'},
        )
        resp = self.post_json(
            f'/transactions/{self.tx.pk}/exclusion/',
            {'excluded_amount': '0'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['code'], 'exclusionCleared')
        self.assertEqual(
            self.assignment().excluded_amount, Decimal('0')
        )

    def test_out_of_range_amounts_are_400(self):
        resp = self.post_json(
            f'/transactions/{self.tx.pk}/exclusion/',
            {'excluded_amount': '-1'},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            resp.json()['code'], 'invalidExcludedAmount'
        )
        resp = self.post_json(
            f'/transactions/{self.tx.pk}/exclusion/',
            {'excluded_amount': '100.01'},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(
            UserTransactionCategory.objects.exists()
        )

    def test_exclusion_404_on_foreign_transaction(self):
        req = make_requisition(self.other, 'req-b')
        foreign = make_account(self.other, req, 'acc-b')
        tx = make_transaction(foreign, 't-x', '-9.00')
        resp = self.post_json(
            f'/transactions/{tx.pk}/exclusion/',
            {'excluded_amount': '5'},
        )
        self.assertEqual(resp.status_code, 404)

    def test_sharers_exclusion_invisible_to_owner(self):
        AccountShare.objects.create(
            account=self.account, shared_with=self.other
        )
        self.client.force_login(self.other)
        resp = self.post_json(
            f'/transactions/{self.tx.pk}/exclusion/',
            {'excluded_amount': '60.00'},
        )
        self.assertEqual(resp.status_code, 200)
        body = self.client.get(
            f'{self.API}/transactions/'
        ).json()
        self.assertEqual(
            body['transactions'][0]['excluded_amount'], '60.00'
        )
        self.assertEqual(
            body['transactions'][0]['counted_amount'], '-40.00'
        )
        # The owner's view of the same transaction is unaffected.
        self.client.force_login(self.user)
        row = self.client.get(
            f'{self.API}/transactions/'
        ).json()['transactions'][0]
        self.assertEqual(row['excluded_amount'], '0.00')
        self.assertEqual(row['counted_amount'], '-100.00')

    def test_clear_category_resets_exclusion_via_rules(self):
        make_rule(
            self.user, self.category, description='shop',
            excluded_amount=Decimal('25.00'),
        )
        self.tx.remittance_information = 'shop'
        self.tx.save(update_fields=['remittance_information'])
        make_assignment(
            self.user, self.tx, self.category, is_manual=True,
            excluded_amount=Decimal('40.00'),
        )
        resp = self.post_json(
            f'/transactions/{self.tx.pk}/category/clear/'
        )
        self.assertEqual(resp.status_code, 200)
        row = self.assignment()
        self.assertFalse(row.is_manual)
        self.assertEqual(row.excluded_amount, Decimal('25.00'))

    def test_rule_save_roundtrips_excluded_amount(self):
        resp = self.post_json('/rules/save/', {
            'category': self.category.pk,
            'priority': 1,
            'description_pattern': 'shop',
            'is_active': True,
            'excluded_amount': '12.50',
        })
        self.assertEqual(resp.status_code, 200)
        rule = CategoryRule.objects.get(user=self.user)
        self.assertEqual(rule.excluded_amount, Decimal('12.50'))
        body = self.client.get(f'{self.API}/rules/').json()
        self.assertEqual(
            body['rules'][0]['excluded_amount'], '12.50'
        )


class OverviewShareApiTests(ApiTestCase):
    """?owner= on the overview and transactions endpoints reads the
    sharer's taxonomy over the share's effective account set;
    share/unshare manage the CategoryOverviewShare rows."""

    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            username='alice', password='pw'
        )
        self.viewer = User.objects.create_user(
            username='bob', password='pw'
        )
        self.third = User.objects.create_user(
            username='carol', password='pw'
        )
        self.req = make_requisition(self.owner)
        self.account = make_account(self.owner, self.req)
        self.second = make_account(self.owner, self.req, 'acc-2')

    def share(self, accounts=()):
        share = CategoryOverviewShare.objects.create(
            sharer=self.owner, shared_with=self.viewer
        )
        share.accounts.set(accounts)
        return share

    def test_share_creates_row_and_notification(self):
        self.client.force_login(self.owner)
        resp = self.post_json('/categories/overview/share/', {
            'username': 'bob',
            'accounts': [self.account.pk],
        })
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['code'], 'overviewShared')
        self.assertEqual(body['params'], {'username': 'bob'})
        share = CategoryOverviewShare.objects.get(
            sharer=self.owner, shared_with=self.viewer
        )
        self.assertEqual(
            [a.pk for a in share.accounts.all()],
            [self.account.pk],
        )
        notification = Notification.objects.get(user=self.viewer)
        self.assertEqual(
            notification.url, '/finance/categories/?owner=alice'
        )

    def test_share_validation_errors(self):
        self.client.force_login(self.owner)
        resp = self.post_json('/categories/overview/share/', {
            'username': ' ',
        })
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['code'], 'provideUsername')
        for username in ('alice', 'nobody'):
            resp = self.post_json('/categories/overview/share/', {
                'username': username,
            })
            self.assertEqual(resp.status_code, 400)
            self.assertEqual(
                resp.json()['code'], 'unknownUsername'
            )

    def test_reshare_updates_account_set(self):
        self.client.force_login(self.owner)
        self.post_json('/categories/overview/share/', {
            'username': 'bob', 'accounts': [self.account.pk],
        })
        resp = self.post_json('/categories/overview/share/', {
            'username': 'bob', 'accounts': [self.second.pk],
        })
        self.assertEqual(resp.status_code, 200)
        share = CategoryOverviewShare.objects.get(
            sharer=self.owner
        )
        self.assertEqual(
            [a.pk for a in share.accounts.all()], [self.second.pk]
        )
        # Re-sharing edits the row — no second notification.
        self.assertEqual(Notification.objects.count(), 1)

    def test_share_rejects_invisible_account(self):
        foreign_req = make_requisition(self.third, 'req-c')
        foreign = make_account(self.third, foreign_req, 'acc-c')
        self.client.force_login(self.owner)
        resp = self.post_json('/categories/overview/share/', {
            'username': 'bob', 'accounts': [foreign.pk],
        })
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['code'], 'unknownAccounts')
        self.assertFalse(CategoryOverviewShare.objects.exists())

    def test_unshare_deletes_and_is_idempotent(self):
        self.share()
        self.client.force_login(self.owner)
        resp = self.post_json('/categories/overview/unshare/', {
            'username': 'bob',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['code'], 'overviewUnshared')
        self.assertFalse(CategoryOverviewShare.objects.exists())
        resp = self.post_json('/categories/overview/unshare/', {
            'username': 'bob',
        })
        self.assertEqual(resp.status_code, 200)

    def test_my_shares_lists_outgoing_shares(self):
        self.share(accounts=[self.account])
        self.client.force_login(self.owner)
        body = self.client.get(
            f'{self.API}/categories/overview/'
        ).json()
        self.assertIsNone(body['view_owner'])
        self.assertEqual(body['shared_with_me'], [])
        self.assertEqual(body['my_shares'], [{
            'username': 'bob',
            'accounts': [str(self.account)],
        }])

    def test_overview_owner_404s_without_share(self):
        self.client.force_login(self.viewer)
        for url in (
            f'{self.API}/categories/overview/?owner=alice',
            f'{self.API}/categories/overview/?owner=nobody',
            f'{self.API}/transactions/?owner=alice',
        ):
            resp = self.client.get(url)
            self.assertEqual(resp.status_code, 404, url)

    def test_owner_param_matching_self_is_own_view(self):
        make_transaction(self.account, 't-1', '-5.00')
        self.client.force_login(self.owner)
        body = self.client.get(
            f'{self.API}/categories/overview/?owner=alice'
        ).json()
        self.assertIsNone(body['view_owner'])
        self.assertEqual(body['rows'][0]['tx_count'], 1)

    def test_overview_owner_uses_sharers_taxonomy(self):
        owner_cat = make_category(self.owner, 'OwnerCat')
        make_category(self.viewer, 'ViewerCat')
        tx = make_transaction(self.account, 't-1', '-10.00')
        make_assignment(self.owner, tx, owner_cat)
        self.share()
        self.client.force_login(self.viewer)
        body = self.client.get(
            f'{self.API}/categories/overview/?owner=alice'
        ).json()
        self.assertEqual(body['view_owner'], 'alice')
        self.assertEqual(body['shared_with_me'], ['alice'])
        self.assertEqual(
            [row['category_name'] for row in body['rows']],
            ['OwnerCat'],
        )
        # The sharer's category list — the viewer's own categories
        # must not leak in.
        names = [c['name'] for c in body['categories']]
        self.assertIn('OwnerCat', names)
        self.assertNotIn('ViewerCat', names)

    def test_overview_owner_respects_sharers_exclusion(self):
        excluded = make_category(
            self.owner, 'Hidden', color=''
        )
        excluded.is_excluded = True
        excluded.save(update_fields=['is_excluded'])
        tx = make_transaction(self.account, 't-1', '-10.00')
        make_assignment(self.owner, tx, excluded)
        self.share()
        self.client.force_login(self.viewer)
        body = self.client.get(
            f'{self.API}/categories/overview/?owner=alice'
        ).json()
        row = body['rows'][0]
        self.assertTrue(row['is_excluded'])
        # sqlite drops the decimal scale ('10' vs '10.00') — compare
        # numerically so the test holds on both backends.
        self.assertEqual(Decimal(row['spent']), Decimal('10.00'))
        # Excluded rows keep their own sums but feed no totals.
        self.assertEqual(body['totals'], {})

    def test_account_scoped_share_limits_rows_and_options(self):
        make_transaction(self.account, 't-1', '-10.00')
        make_transaction(self.second, 't-2', '-20.00')
        self.share(accounts=[self.account])
        self.client.force_login(self.viewer)
        body = self.client.get(
            f'{self.API}/categories/overview/?owner=alice'
        ).json()
        self.assertEqual(body['accounts'], [{
            'id': self.account.pk, 'label': str(self.account),
        }])
        self.assertEqual(len(body['rows']), 1)
        self.assertEqual(body['rows'][0]['tx_count'], 1)

    def test_reshared_account_shows_sharers_categories(self):
        """The sharer doesn't own the account — an AccountShare —
        but their own categorization is what the viewer sees."""
        AccountShare.objects.create(
            account=self.account, shared_with=self.viewer
        )
        sharer_cat = make_category(self.viewer, 'SharerCat')
        tx = make_transaction(self.account, 't-1', '-10.00')
        make_assignment(self.viewer, tx, sharer_cat)
        share = CategoryOverviewShare.objects.create(
            sharer=self.viewer, shared_with=self.third
        )
        share.accounts.set([self.account])
        self.client.force_login(self.third)
        body = self.client.get(
            f'{self.API}/categories/overview/?owner=bob'
        ).json()
        self.assertEqual(
            body['rows'][0]['category_name'], 'SharerCat'
        )

    def test_revoked_account_share_shrinks_overview(self):
        AccountShare.objects.create(
            account=self.account, shared_with=self.viewer
        )
        make_transaction(self.account, 't-1', '-10.00')
        share = CategoryOverviewShare.objects.create(
            sharer=self.viewer, shared_with=self.third
        )
        share.accounts.set([self.account])
        self.client.force_login(self.third)
        body = self.client.get(
            f'{self.API}/categories/overview/?owner=bob'
        ).json()
        self.assertEqual(body['rows'][0]['tx_count'], 1)
        # Revoking the underlying AccountShare empties the
        # effective account set — no cleanup needed.
        AccountShare.objects.all().delete()
        body = self.client.get(
            f'{self.API}/categories/overview/?owner=bob'
        ).json()
        self.assertEqual(body['rows'], [])
        self.assertEqual(body['accounts'], [])

    def test_transactions_owner_scopes_and_annotates(self):
        owner_cat = make_category(self.owner, 'OwnerCat')
        tx = make_transaction(
            self.account, 't-1', '-10.00', creditor_name='Rimi'
        )
        make_assignment(
            self.owner, tx, owner_cat,
            excluded_amount=Decimal('4.00'),
        )
        make_transaction(self.second, 't-2', '-20.00')
        self.share(accounts=[self.account])
        self.client.force_login(self.viewer)
        body = self.client.get(
            f'{self.API}/transactions/?owner=alice'
        ).json()
        self.assertEqual(body['count'], 1)
        row = body['transactions'][0]
        self.assertEqual(row['transaction_id'], 't-1')
        self.assertEqual(
            row['effective_category']['name'], 'OwnerCat'
        )
        # The sharer's per-transaction exclusion applies too.
        # (Decimal() compares — sqlite drops the .00 scale.)
        self.assertEqual(
            Decimal(row['excluded_amount']), Decimal('4.00')
        )
        self.assertEqual(
            Decimal(row['counted_amount']), Decimal('-6.00')
        )
        self.assertEqual(body['accounts'], [{
            'id': self.account.pk, 'label': str(self.account),
        }])
        self.assertEqual(body['counterparties'], ['Rimi'])
        self.assertIn(
            'OwnerCat', [c['name'] for c in body['categories']]
        )
