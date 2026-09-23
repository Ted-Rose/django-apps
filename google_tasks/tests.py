import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase
from django.urls import reverse

from google_tasks.models import GoogleTask, GoogleTaskList
from google_tasks.services import process_task_labels
from google_tasks.views import REORDER_CAP


class ReorderViewTests(TestCase):
    """Shared payload validation for both reorder endpoints."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.other_user = User.objects.create_user(
            username='bob', password='pw'
        )
        self.client.force_login(self.user)
        self.task_list = GoogleTaskList.objects.create(
            user=self.user, list_id='list-1', title='List 1'
        )
        self.other_list = GoogleTaskList.objects.create(
            user=self.user, list_id='list-2', title='List 2'
        )
        self.url = reverse('google_tasks:reorder_tasks')
        self.starred_url = reverse('google_tasks:reorder_starred')

    def make_task(self, task_id, order, starred=False,
                  starred_order=None, task_list=None):
        return GoogleTask.objects.create(
            user=self.user,
            task_id=task_id,
            task_list=task_list or self.task_list,
            title=task_id,
            is_starred=starred,
            task_order=order,
            starred_order=starred_order,
        )

    def post(self, payload, url=None, raw=None):
        return self.client.post(
            url or self.url,
            data=raw if raw is not None else json.dumps(payload),
            content_type='application/json',
        )

    # --- validation ---

    def test_invalid_json_returns_400(self):
        resp = self.post(None, raw='{not json')
        self.assertEqual(resp.status_code, 400)

    def test_missing_updates_returns_400(self):
        resp = self.post({})
        self.assertEqual(resp.status_code, 400)

    def test_empty_updates_returns_400(self):
        resp = self.post({'updates': []})
        self.assertEqual(resp.status_code, 400)

    def test_updates_not_a_list_returns_400(self):
        resp = self.post({'updates': {'task_id': 'a'}})
        self.assertEqual(resp.status_code, 400)

    def test_too_many_updates_returns_400(self):
        updates = [
            {'task_id': f't{i}', 'position': float(i)}
            for i in range(REORDER_CAP + 1)
        ]
        resp = self.post({'updates': updates})
        self.assertEqual(resp.status_code, 400)

    def test_update_missing_task_id_returns_400(self):
        resp = self.post({'updates': [{'position': 1.0}]})
        self.assertEqual(resp.status_code, 400)

    def test_update_non_numeric_position_returns_400(self):
        self.make_task('a', 1.0)
        resp = self.post({'updates': [
            {'task_id': 'a', 'position': 'high'},
        ]})
        self.assertEqual(resp.status_code, 400)

    def test_update_non_finite_position_returns_400(self):
        self.make_task('a', 1.0)
        resp = self.post({'updates': [
            {'task_id': 'a', 'position': float('nan')},
        ]})
        self.assertEqual(resp.status_code, 400)

    def test_duplicate_task_ids_return_400(self):
        self.make_task('a', 1.0)
        resp = self.post({'updates': [
            {'task_id': 'a', 'position': 1.0},
            {'task_id': 'a', 'position': 2.0},
        ]})
        self.assertEqual(resp.status_code, 400)

    def test_duplicate_positions_return_400(self):
        self.make_task('a', 1.0)
        self.make_task('b', 2.0)
        resp = self.post({'updates': [
            {'task_id': 'a', 'position': 5.0},
            {'task_id': 'b', 'position': 5.0},
        ]})
        self.assertEqual(resp.status_code, 400)

    def test_unknown_task_id_returns_400(self):
        self.make_task('a', 1.0)
        resp = self.post({'updates': [
            {'task_id': 'a', 'position': 1.0},
            {'task_id': 'ghost', 'position': 2.0},
        ]})
        self.assertEqual(resp.status_code, 400)

    def test_other_users_task_id_returns_400(self):
        GoogleTask.objects.create(
            user=self.other_user, task_id='foreign', title='foreign'
        )
        resp = self.post({'updates': [
            {'task_id': 'foreign', 'position': 1.0},
        ]})
        self.assertEqual(resp.status_code, 400)

    def test_task_list_scope_mismatch_returns_400(self):
        task = self.make_task('a', 1.0, task_list=self.other_list)
        resp = self.post({
            'task_list_id': 'list-1',
            'updates': [{'task_id': task.task_id, 'position': 1.0}],
        })
        self.assertEqual(resp.status_code, 400)

    def test_task_list_scope_match_succeeds(self):
        task = self.make_task('a', 1.0, task_list=self.other_list)
        resp = self.post({
            'task_list_id': 'list-2',
            'updates': [{'task_id': task.task_id, 'position': 7.0}],
        })
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.task_order, 7.0)

    def test_requires_login(self):
        self.client.logout()
        resp = self.post({'updates': [
            {'task_id': 'a', 'position': 1.0},
        ]})
        self.assertEqual(resp.status_code, 302)

    # --- happy paths ---

    def test_single_update(self):
        task = self.make_task('a', 1.0)
        resp = self.post({'updates': [
            {'task_id': 'a', 'position': 42.5},
        ]})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        task.refresh_from_db()
        self.assertEqual(task.task_order, 42.5)

    def test_swap_two_tasks_in_one_request(self):
        """Two-phase update: swapping positions must not trip the
        unique constraint mid-flight."""
        a = self.make_task('a', 1.0)
        b = self.make_task('b', 2.0)
        resp = self.post({'updates': [
            {'task_id': 'a', 'position': 2.0},
            {'task_id': 'b', 'position': 1.0},
        ]})
        self.assertEqual(resp.status_code, 200)
        a.refresh_from_db()
        b.refresh_from_db()
        self.assertEqual(a.task_order, 2.0)
        self.assertEqual(b.task_order, 1.0)

    def test_full_list_reorder_round_trip(self):
        tasks = [
            self.make_task(f't{i}', float(i)) for i in range(1, 5)
        ]
        updates = [
            {'task_id': t.task_id, 'position': float(i)}
            for i, t in enumerate(reversed(tasks), start=1)
        ]
        resp = self.post({'updates': updates})
        self.assertEqual(resp.status_code, 200)
        for i, t in enumerate(reversed(tasks), start=1):
            t.refresh_from_db()
            self.assertEqual(t.task_order, float(i))

    # --- conflict handling ---

    def test_integrity_error_returns_409_position_conflict(self):
        self.make_task('a', 1.0)
        error = IntegrityError(
            'duplicate key value violates unique constraint '
            '"unique_task_order_per_user"'
        )
        with patch.object(
            GoogleTask.objects, 'bulk_update', side_effect=error
        ):
            resp = self.post({'updates': [
                {'task_id': 'a', 'position': 2.0},
            ]})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['error'], 'position_conflict')

    def test_unrelated_integrity_error_propagates(self):
        self.make_task('a', 1.0)
        with patch.object(
            GoogleTask.objects,
            'bulk_update',
            side_effect=IntegrityError('some other failure'),
        ):
            with self.assertRaises(IntegrityError):
                self.post({'updates': [
                    {'task_id': 'a', 'position': 2.0},
                ]})

    # --- starred scope ---

    def test_starred_reorder_updates_starred_order(self):
        a = self.make_task('a', 1.0, starred=True, starred_order=1.0)
        b = self.make_task('b', 2.0, starred=True, starred_order=2.0)
        resp = self.post({'updates': [
            {'task_id': 'a', 'position': 2.0},
            {'task_id': 'b', 'position': 1.0},
        ]}, url=self.starred_url)
        self.assertEqual(resp.status_code, 200)
        a.refresh_from_db()
        b.refresh_from_db()
        self.assertEqual(a.starred_order, 2.0)
        self.assertEqual(b.starred_order, 1.0)
        # task_order untouched
        self.assertEqual(a.task_order, 1.0)
        self.assertEqual(b.task_order, 2.0)

    def test_starred_reorder_rejects_non_starred_task(self):
        self.make_task('a', 1.0, starred=False)
        resp = self.post({'updates': [
            {'task_id': 'a', 'position': 1.0},
        ]}, url=self.starred_url)
        self.assertEqual(resp.status_code, 400)

    def test_starred_scope_isolated_from_task_order(self):
        """Reordering via the starred endpoint must not write to
        task_order."""
        a = self.make_task('a', 9.0, starred=True, starred_order=3.0)
        resp = self.post({'updates': [
            {'task_id': 'a', 'position': 1.0},
        ]}, url=self.starred_url)
        self.assertEqual(resp.status_code, 200)
        a.refresh_from_db()
        self.assertEqual(a.starred_order, 1.0)
        self.assertEqual(a.task_order, 9.0)


class ToggleStarOrderTests(TestCase):

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )
        self.client.force_login(self.user)
        self.url = lambda tid: reverse(
            'google_tasks:toggle_star', args=[tid]
        )

    def make_task(self, task_id, starred=False, starred_order=None):
        return GoogleTask.objects.create(
            user=self.user, task_id=task_id, title=task_id,
            is_starred=starred, starred_order=starred_order,
        )

    def test_unstar_clears_starred_order(self):
        task = self.make_task('a', starred=True, starred_order=1.0)
        resp = self.client.post(self.url('a'))
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertFalse(task.is_starred)
        self.assertIsNone(task.starred_order)

    def test_star_assigns_max_plus_one(self):
        self.make_task('a', starred=True, starred_order=4.0)
        task = self.make_task('b')
        resp = self.client.post(self.url('b'))
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertTrue(task.is_starred)
        self.assertEqual(task.starred_order, 5.0)


class ProcessTaskLabelsStarTests(TestCase):
    """Starring via hashtags places the task at the top of the
    starred view (starred_order=1) and shifts existing starred
    tasks down."""

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )
        self.task_list = GoogleTaskList.objects.create(
            user=self.user, list_id='list-1', title='List 1'
        )

    def make_task(self, task_id, title, starred=False,
                  starred_order=None):
        return GoogleTask.objects.create(
            user=self.user, task_id=task_id, title=title,
            task_list=self.task_list, is_starred=starred,
            starred_order=starred_order,
        )

    def test_starred_hashtag_assigns_order_one(self):
        task = self.make_task('a', 'call bob #starred')
        stats = process_task_labels(self.user, creds=None)
        task.refresh_from_db()
        self.assertTrue(task.is_starred)
        self.assertEqual(task.starred_order, 1.0)
        self.assertEqual(stats['starred'], 1)

    def test_new_star_shifts_existing_positions_down(self):
        old = self.make_task(
            'old', 'old', starred=True, starred_order=1.0
        )
        mid = self.make_task(
            'mid', 'mid', starred=True, starred_order=2.0
        )
        new = self.make_task('new', 'do it #star')
        process_task_labels(self.user, creds=None)
        for task in (old, mid, new):
            task.refresh_from_db()
        self.assertEqual(new.starred_order, 1.0)
        self.assertEqual(old.starred_order, 2.0)
        self.assertEqual(mid.starred_order, 3.0)
