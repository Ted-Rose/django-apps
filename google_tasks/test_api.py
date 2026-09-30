"""Additional coverage for the django-ninja layer at /api/tasks/ —
review follow-ups split out of tests.py (see the commit-review fix
list): BOLA on label_ids, the divider round-trip, the uniform 422
error shape, ?label= scoping on trash counts, encoded SPA `next`
targets, and the 2xx-with-success:false status floor."""
import json
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
        counts = {l['name']: l['task_count'] for l in body['labels']}
        self.assertEqual(counts['Home'], 1)
        self.assertEqual(counts['Work'], 1)

        # Filtered: counts mirror the view — computed over the
        # label-filtered base, so Work drops to 0.
        resp = self.client.get(f'{self.API}/trash/?label=Home')
        body = resp.json()
        self.assertEqual(
            [t['task_id'] for t in body['tasks']], ['a']
        )
        counts = {l['name']: l['task_count'] for l in body['labels']}
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

    # --- 2xx success:false floor ---

    def test_failed_sync_is_500_not_400(self):
        with patch('google_tasks.views.get_creds_dict',
                   return_value={'token': 't'}), \
                patch('google_tasks.views.sync_all',
                      return_value=False):
            resp = self.client.post(f'{self.API}/sync/')
        self.assertEqual(resp.status_code, 500)
        self.assertEqual(resp.json()['error'], 'server_error')
