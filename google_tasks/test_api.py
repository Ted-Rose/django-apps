"""Additional coverage for the django-ninja layer at /api/tasks/ —
review follow-ups split out of tests.py (see the commit-review fix
list): BOLA on label_ids, the divider round-trip, the uniform 422
error shape, ?label= scoping on trash counts, encoded SPA `next`
targets, and the 2xx-with-success:false status floor."""
import json
from datetime import datetime, timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from google_tasks.models import GoogleTask, GoogleTaskList, TaskLabel


class TasksApiReviewTests(TestCase):

    API = '/api/tasks'

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

    def make_task(self, task_id, order=1.0, user=None, **kwargs):
        return GoogleTask.objects.create(
            user=user or self.user,
            task_id=task_id,
            task_list=self.task_list,
            title=task_id,
            task_order=order,
            **kwargs,
        )

    def post_json(self, path, payload=None):
        return self.client.post(
            f'{self.API}{path}',
            data=json.dumps(payload or {}),
            content_type='application/json',
        )

    # --- BOLA: cross-user label_ids on task update ---

    def test_update_task_rejects_other_users_label_ids(self):
        task = self.make_task('a')
        foreign_label = TaskLabel.objects.create(
            user=self.other_user, name='BobLabel'
        )
        own_label = TaskLabel.objects.create(
            user=self.user, name='Mine'
        )
        task.labels.add(own_label)
        resp = self.post_json(
            f'/task/{task.task_id}/update/',
            {'title': 'a', 'label_ids': [foreign_label.id]},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'bad_request')
        # Labels untouched — no silent cross-user assignment.
        self.assertEqual(
            list(task.labels.values_list('name', flat=True)),
            ['Mine'],
        )

    def test_update_task_accepts_own_label_ids(self):
        task = self.make_task('a')
        label = TaskLabel.objects.create(user=self.user, name='Home')
        resp = self.post_json(
            f'/task/{task.task_id}/update/',
            {'title': 'a', 'label_ids': [label.id]},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        self.assertEqual(
            list(task.labels.values_list('name', flat=True)), ['Home']
        )

    # --- divider create/update/delete round-trip ---

    def test_divider_round_trip(self):
        resp = self.post_json(
            '/divider/create/', {'task_list_id': 'list-1'}
        )
        self.assertEqual(resp.status_code, 200)
        task_id = resp.json()['task_id']
        divider = GoogleTask.objects.get(task_id=task_id)
        self.assertTrue(divider.is_divider)
        self.assertEqual(divider.user, self.user)

        resp = self.post_json(
            f'/divider/{task_id}/update/', {'title': 'Section A'}
        )
        self.assertEqual(resp.status_code, 200)
        divider.refresh_from_db()
        self.assertEqual(divider.title, 'Section A')

        resp = self.post_json(f'/divider/{task_id}/delete/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(
            GoogleTask.objects.filter(task_id=task_id).exists()
        )

    def test_divider_update_scoped_to_user(self):
        foreign = self.make_task(
            'div-x', user=self.other_user, is_divider=True
        )
        resp = self.post_json(
            f'/divider/{foreign.task_id}/update/', {'title': 'hax'}
        )
        # update_divider swallows the 404 into its generic 400 — the
        # important part is the foreign divider is never mutated.
        self.assertEqual(resp.status_code, 400)
        foreign.refresh_from_db()
        self.assertEqual(foreign.title, 'div-x')

    # --- 422 uniform error shape ---

    def test_422_body_uses_uniform_error_shape(self):
        resp = self.post_json(
            '/tasks/reorder/', {'updates': 'not-a-list'}
        )
        self.assertEqual(resp.status_code, 422)
        body = resp.json()
        self.assertEqual(body['error'], 'validation_error')
        self.assertIsInstance(body['detail'], list)

    def test_422_on_oversized_reorder_payload(self):
        updates = [
            {'task_id': f't{i}', 'position': float(i)}
            for i in range(501)
        ]
        resp = self.post_json(
            '/tasks/reorder/', {'updates': updates}
        )
        self.assertEqual(resp.status_code, 422)
        self.assertEqual(resp.json()['error'], 'validation_error')

    # --- trash ?label= scoping ---

    def _trash_label(self, name):
        return TaskLabel.objects.create(user=self.user, name=name)

    def _trashed(self, task_id, label=None):
        task = self.make_task(
            task_id,
            is_deleted=True,
            deleted_at=timezone.now(),
        )
        if label:
            task.labels.add(label)
        return task

    def test_trash_label_filter_scopes_counts(self):
        home = self._trash_label('Home')
        work = self._trash_label('Work')
        self._trashed('a', label=home)
        self._trashed('b', label=work)

        # Unfiltered: each label counts its own trashed tasks.
        body = self.client.get(f'{self.API}/trash/').json()
        counts = {
            label['name']: label['task_count']
            for label in body['labels']
        }
        self.assertEqual(counts['Home'], 1)
        self.assertEqual(counts['Work'], 1)

        # Filtered: counts mirror the view — computed over the
        # label-filtered base, so Work drops to 0.
        resp = self.client.get(f'{self.API}/trash/?label=Home')
        body = resp.json()
        self.assertEqual(
            [t['task_id'] for t in body['tasks']], ['a']
        )
        counts = {
            label['name']: label['task_count']
            for label in body['labels']
        }
        self.assertEqual(counts['Home'], 1)
        self.assertEqual(counts['Work'], 0)

    def test_trash_serializes_deleted_at(self):
        task = self._trashed('a')
        body = self.client.get(f'{self.API}/trash/').json()
        self.assertEqual(body['tasks'][0]['task_id'], 'a')
        self.assertIsNotNone(body['tasks'][0]['deleted_at'])
        self.assertTrue(
            body['tasks'][0]['deleted_at'].startswith(
                task.deleted_at.strftime('%Y-%m-%d')
            )
        )

    # --- next/login_url → encoded SPA URLs ---

    def test_login_url_encodes_spa_next(self):
        self.client.logout()
        resp = self.client.get(f'{self.API}/trash/?label=Home')
        self.assertEqual(resp.status_code, 401)
        login_url = resp.json()['login_url']
        next_param = parse_qs(urlparse(login_url).query)['next'][0]
        self.assertEqual(next_param, '/tasks/trash/?label=Home')

    def test_google_reauth_next_points_at_spa(self):
        from google_api.models import GoogleOAuthCredentials
        GoogleOAuthCredentials.objects.create(
            user=self.user,
            access_token='dead',
            refresh_token='dead',
            token_expiry=timezone.now(),
            scopes=[],
        )
        with patch('google_tasks.views.get_creds_dict',
                   return_value=None):
            resp = self.client.get(f'{self.API}/dashboard/')
        self.assertEqual(resp.status_code, 401)
        auth_url = resp.json()['authorization_url']
        next_param = parse_qs(urlparse(auth_url).query)['next'][0]
        self.assertEqual(next_param, '/tasks/')

    # --- i18n `code`/`params` contract ---
    # Mutation failures carry a stable `code` the SPA resolves
    # through its server catalog, with `detail` as the English
    # fallback and `params` for interpolation.

    def test_reorder_empty_updates_carries_code(self):
        resp = self.post_json('/tasks/reorder/', {'updates': []})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['code'], 'emptyUpdates')

    def test_reorder_duplicate_positions_carries_code(self):
        self.make_task('a', order=1.0)
        self.make_task('b', order=2.0)
        resp = self.post_json(
            '/tasks/reorder/',
            {'updates': [
                {'task_id': 'a', 'position': 1.0},
                {'task_id': 'b', 'position': 1.0},
            ]},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['code'], 'duplicatePositions')

    def test_update_task_empty_title_carries_code(self):
        task = self.make_task('a')
        resp = self.post_json(
            f'/task/{task.task_id}/update/', {'title': '  '}
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['code'], 'emptyTitle')

    def test_update_task_foreign_labels_carry_code(self):
        task = self.make_task('a')
        foreign_label = TaskLabel.objects.create(
            user=self.other_user, name='BobLabel'
        )
        resp = self.post_json(
            f'/task/{task.task_id}/update/',
            {'title': 'a', 'label_ids': [foreign_label.id]},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['code'], 'invalidLabelIds')

    def test_update_task_bad_order_value_carries_params(self):
        task = self.make_task('a')
        resp = self.post_json(
            f'/task/{task.task_id}/update/',
            {'title': 'a', 'task_order': None},
        )
        self.assertEqual(resp.status_code, 400)
        body = resp.json()
        self.assertEqual(body['code'], 'invalidOrderValue')
        self.assertEqual(body['params'], {'field': 'task_order'})

    # --- 2xx success:false floor ---

    def test_failed_sync_is_500_not_400(self):
        with patch('google_tasks.views.get_creds_dict',
                   return_value={'token': 't'}), \
                patch('google_tasks.views.sync_all',
                      return_value=False):
            resp = self.client.post(f'{self.API}/sync/')
        self.assertEqual(resp.status_code, 500)
        self.assertEqual(resp.json()['error'], 'server_error')


class StatsApiTests(TestCase):
    """GET /api/tasks/stats/ — the productivity dashboard behind
    /tasks/stats. Pure DB read over completed tasks; buckets are UTC
    ISO weeks (Mon start) / calendar months, zero-filled over the
    requested window."""

    API = '/api/tasks'

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

    def make_task(self, task_id, user=None, **kwargs):
        kwargs.setdefault('task_list', self.task_list)
        return GoogleTask.objects.create(
            user=user or self.user,
            task_id=task_id,
            title=task_id,
            **kwargs,
        )

    def completed_task(self, task_id, completed, **kwargs):
        return self.make_task(
            task_id, status='completed', completed=completed, **kwargs
        )

    @staticmethod
    def at(day, hour=12):
        """Aware datetime (UTC per TIME_ZONE) on a `date` at noon —
        mid-day avoids midnight edge effects in week bucketing."""
        return timezone.make_aware(
            datetime(day.year, day.month, day.day, hour)
        )

    @staticmethod
    def this_week_monday():
        today = timezone.now().date()
        return today - timedelta(days=today.weekday())

    def get_stats(self, params=''):
        return self.client.get(f'{self.API}/stats/{params}')

    # --- auth / isolation ---

    def test_unauthenticated_gets_401(self):
        self.client.logout()
        resp = self.get_stats()
        self.assertEqual(resp.status_code, 401)
        body = resp.json()
        self.assertEqual(body['error'], 'unauthenticated')
        self.assertIn('login_url', body)
        # spa_url_for maps the API path back onto the SPA page.
        next_param = parse_qs(
            urlparse(body['login_url']).query
        )['next'][0]
        self.assertEqual(next_param, '/tasks/stats/')

    def test_stats_scoped_to_user(self):
        self.completed_task('a', self.at(self.this_week_monday()))
        self.completed_task(
            'b', self.at(self.this_week_monday()), user=self.other_user
        )
        body = self.get_stats().json()
        self.assertEqual(body['summary']['all_time'], 1)
        self.assertEqual(body['weekly'][-1]['total'], 1)

    # --- bucketing ---

    def test_week_boundary_tasks_land_in_their_own_buckets(self):
        monday = self.this_week_monday()
        # Sunday 23:00 closes last week; Monday 00:00 opens this one.
        self.completed_task(
            'sunday', self.at(monday - timedelta(days=1), hour=23)
        )
        self.completed_task(
            'monday', self.at(monday, hour=0)
        )
        body = self.get_stats().json()
        self.assertEqual(body['weekly'][-1]['total'], 1)
        self.assertEqual(body['weekly'][-2]['total'], 1)
        self.assertEqual(
            body['weekly'][-1]['start'], monday.isoformat()
        )
        self.assertEqual(body['summary']['this_week'], 1)
        self.assertEqual(body['summary']['last_week'], 1)

    def test_month_buckets(self):
        today = timezone.now().date()
        month_start = today.replace(day=1)
        self.completed_task('this', self.at(month_start))
        prev_month_end = month_start - timedelta(days=1)
        self.completed_task('prev', self.at(prev_month_end))
        body = self.get_stats().json()
        self.assertEqual(
            body['monthly'][-1]['start'], month_start.isoformat()
        )
        self.assertEqual(body['monthly'][-1]['total'], 1)
        self.assertEqual(body['monthly'][-2]['total'], 1)
        self.assertEqual(body['summary']['this_month'], 1)
        self.assertEqual(body['summary']['last_month'], 1)

    def test_zero_filled_weeks(self):
        body = self.get_stats('?weeks=4&months=2').json()
        self.assertEqual(len(body['weekly']), 4)
        self.assertTrue(
            all(b['total'] == 0 for b in body['weekly'])
        )
        # Chronological order, current week last.
        starts = [b['start'] for b in body['weekly']]
        self.assertEqual(starts, sorted(starts))
        self.assertEqual(len(body['monthly']), 2)

    # --- labels / lists ---

    def test_multi_label_task_counts_once_per_label(self):
        home = TaskLabel.objects.create(user=self.user, name='Home')
        work = TaskLabel.objects.create(user=self.user, name='Work')
        task = self.completed_task(
            'a', self.at(self.this_week_monday())
        )
        task.labels.add(home, work)
        body = self.get_stats().json()
        current = body['weekly'][-1]
        self.assertEqual(current['total'], 1)
        self.assertEqual(
            current['by_label'], {'Home': 1, 'Work': 1}
        )
        self.assertEqual(current['unlabeled'], 0)
        # Legend carries both labels with colors.
        legend = {label['name']: label['color'] for label in body['labels']}
        self.assertEqual(set(legend), {'Home', 'Work'})

    def test_unlabeled_tasks_bucket_separately(self):
        self.completed_task('a', self.at(self.this_week_monday()))
        body = self.get_stats().json()
        current = body['weekly'][-1]
        self.assertEqual(current['total'], 1)
        self.assertEqual(current['by_label'], {})
        self.assertEqual(current['unlabeled'], 1)

    def test_by_list_breakdown_and_unlisted(self):
        self.completed_task(
            'listed', self.at(self.this_week_monday())
        )
        self.completed_task(
            'unlisted', self.at(self.this_week_monday()),
            task_list=None,
        )
        body = self.get_stats().json()
        current = body['weekly'][-1]
        self.assertEqual(current['total'], 2)
        by_list = current['by_list']
        self.assertEqual(by_list['List 1'], 1)
        # NULL task_list lands under the '' key (SPA → "Unlisted").
        self.assertEqual(by_list[''], 1)

    def test_list_param_filters_stats(self):
        self.completed_task('in', self.at(self.this_week_monday()))
        self.completed_task(
            'out', self.at(self.this_week_monday()),
            task_list=self.other_list,
        )
        body = self.get_stats('?list=list-2').json()
        self.assertEqual(body['summary']['all_time'], 1)
        self.assertEqual(body['weekly'][-1]['total'], 1)
        self.assertEqual(
            body['weekly'][-1]['by_list'], {'List 2': 1}
        )

    # --- base queryset semantics ---

    def test_deleted_divider_and_active_tasks_excluded(self):
        monday = self.at(self.this_week_monday())
        self.completed_task('gone', monday, is_deleted=True)
        self.completed_task('div', monday, is_divider=True)
        self.make_task('active', status='needsAction')
        self.completed_task('done', monday)
        body = self.get_stats().json()
        self.assertEqual(body['summary']['all_time'], 1)
        self.assertEqual(body['weekly'][-1]['total'], 1)

    def test_archived_completed_tasks_are_included(self):
        self.completed_task(
            'arch', self.at(self.this_week_monday()), is_archived=True
        )
        body = self.get_stats().json()
        self.assertEqual(body['summary']['all_time'], 1)
        self.assertEqual(body['weekly'][-1]['total'], 1)

    def test_completed_null_counts_as_unknown_date(self):
        self.make_task(
            'legacy', status='completed', completed=None
        )
        self.completed_task('dated', self.at(self.this_week_monday()))
        body = self.get_stats().json()
        self.assertEqual(body['summary']['unknown_date'], 1)
        # Counted in all_time but never silently bucketed.
        self.assertEqual(body['summary']['all_time'], 2)
        self.assertEqual(
            sum(b['total'] for b in body['weekly']), 1
        )

    # --- param validation ---

    def test_weeks_and_months_caps(self):
        self.assertEqual(
            self.get_stats('?weeks=53').status_code, 422
        )
        self.assertEqual(
            self.get_stats('?months=37').status_code, 422
        )
        self.assertEqual(
            self.get_stats('?weeks=0').status_code, 422
        )
        self.assertEqual(
            self.get_stats('?months=0').status_code, 422
        )
        resp = self.get_stats('?weeks=52&months=36')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(len(body['weekly']), 52)
        self.assertEqual(len(body['monthly']), 36)


class LabelsApiTests(TestCase):
    """GET /api/tasks/labels/ + POST /api/tasks/label/{id}/update/ —
    the /tasks/labels management page's endpoints. Label colors are
    app-local; nothing here touches Google."""

    API = '/api/tasks'

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
        self.label = TaskLabel.objects.create(
            user=self.user, name='Home', color='#ff0000'
        )

    def post_json(self, path, payload=None):
        return self.client.post(
            f'{self.API}{path}',
            data=json.dumps(payload or {}),
            content_type='application/json',
        )

    def make_task(self, task_id, **kwargs):
        return GoogleTask.objects.create(
            user=self.user,
            task_id=task_id,
            task_list=self.task_list,
            title=task_id,
            **kwargs,
        )

    def test_labels_returns_labels_with_active_counts(self):
        self.make_task('a').labels.add(self.label)
        self.make_task(
            'done', status='completed'
        ).labels.add(self.label)
        TaskLabel.objects.create(user=self.other_user, name='Foreign')
        resp = self.client.get(f'{self.API}/labels/')
        self.assertEqual(resp.status_code, 200)
        labels = resp.json()['labels']
        # Other users' labels are never listed.
        self.assertEqual([row['name'] for row in labels], ['Home'])
        self.assertEqual(labels[0]['color'], '#ff0000')
        # Only needsAction tasks count.
        self.assertEqual(labels[0]['task_count'], 1)

    def test_labels_unauthenticated_gets_401(self):
        self.client.logout()
        resp = self.client.get(f'{self.API}/labels/')
        self.assertEqual(resp.status_code, 401)

    def test_update_label_color(self):
        resp = self.post_json(
            f'/label/{self.label.id}/update/', {'color': '#00ff00'}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        self.label.refresh_from_db()
        self.assertEqual(self.label.color, '#00ff00')

    def test_update_label_rejects_bad_hex(self):
        resp = self.post_json(
            f'/label/{self.label.id}/update/', {'color': 'red'}
        )
        self.assertEqual(resp.status_code, 422)
        self.label.refresh_from_db()
        self.assertEqual(self.label.color, '#ff0000')

    def test_update_label_scoped_to_user(self):
        foreign = TaskLabel.objects.create(
            user=self.other_user, name='Foreign'
        )
        resp = self.post_json(
            f'/label/{foreign.id}/update/', {'color': '#00ff00'}
        )
        self.assertEqual(resp.status_code, 404)
        foreign.refresh_from_db()
        self.assertEqual(foreign.color, '#0d6efd')
