import json
import os
import tempfile
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.http import Http404
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from django_apps.views import spa_shell
from django_vite.core.asset_loader import (
    DjangoViteAssetLoader,
    ManifestEntry,
)
from google_tasks.models import GoogleTask, GoogleTaskList
from google_tasks.services import process_task_labels
from google_tasks.views import REORDER_CAP


class ReorderViewTests(TestCase):
    """Shared payload validation for both reorder endpoints.

    Post-cutover the only public reorder surface is the ninja API —
    these exercise /api/tasks/… through _adapt(), so schema-rejected
    payloads come back 422 and view-level failures keep their status
    with the uniform {error, detail} shape.
    """

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
        self.url = '/api/tasks/tasks/reorder/'
        self.starred_url = '/api/tasks/starred/reorder/'

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
        # Ninja passes the unparseable body through; the view's own
        # json.loads fails → its 400 survives _adapt.
        resp = self.post(None, raw='{not json')
        self.assertEqual(resp.status_code, 400)

    def test_missing_updates_returns_422(self):
        resp = self.post({})
        self.assertEqual(resp.status_code, 422)

    def test_empty_updates_returns_400(self):
        # Passes the schema; the view rejects empty lists.
        resp = self.post({'updates': []})
        self.assertEqual(resp.status_code, 400)

    def test_updates_not_a_list_returns_422(self):
        resp = self.post({'updates': {'task_id': 'a'}})
        self.assertEqual(resp.status_code, 422)

    def test_too_many_updates_returns_422(self):
        # ReorderIn.updates has max_length=REORDER_CAP → schema 422.
        updates = [
            {'task_id': f't{i}', 'position': float(i)}
            for i in range(REORDER_CAP + 1)
        ]
        resp = self.post({'updates': updates})
        self.assertEqual(resp.status_code, 422)

    def test_update_missing_task_id_returns_422(self):
        resp = self.post({'updates': [{'position': 1.0}]})
        self.assertEqual(resp.status_code, 422)

    def test_update_non_numeric_position_returns_422(self):
        self.make_task('a', 1.0)
        resp = self.post({'updates': [
            {'task_id': 'a', 'position': 'high'},
        ]})
        self.assertEqual(resp.status_code, 422)

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
        # API contract: JSON 401, never a login redirect.
        self.assertEqual(resp.status_code, 401)

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
        # _adapt maps the view's {'error': 'position_conflict'} onto
        # the uniform API shape.
        body = resp.json()
        self.assertEqual(body['error'], 'conflict')
        self.assertEqual(body['detail'], 'position_conflict')

    def test_unrelated_integrity_error_propagates(self):
        self.make_task('a', 1.0)
        with patch.object(
            GoogleTask.objects,
            'bulk_update',
            side_effect=IntegrityError('some other failure'),
        ):
            # Not a position-conflict name — ninja re-raises
            # unhandled exceptions rather than masking them as 4xx.
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
        self.url = lambda tid: f'/api/tasks/task/{tid}/toggle-star/'

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

    def test_unmatched_hashtag_does_not_block_other_tasks(self):
        """One bad hashtag must not abort processing — a different
        task's #star still applies and the failure lands in
        stats['unmatched']."""
        self.make_task(
            'bad', 'consultation with physiotherapist #growth'
        )
        good = self.make_task('good', 'call bob #star')
        stats = process_task_labels(self.user, creds=None)
        good.refresh_from_db()
        self.assertTrue(good.is_starred)
        self.assertEqual(good.starred_order, 1.0)
        self.assertEqual(stats['starred'], 1)
        self.assertEqual(stats['unmatched'], [{
            'task_title': 'consultation with physiotherapist #growth',
            'hashtag': 'growth',
        }])

    def test_unmatched_hashtag_skips_only_its_own_label(self):
        """Matched labels on the same task are still assigned; only
        the unmatched hashtag is skipped."""
        from google_tasks.models import TaskLabel
        label = TaskLabel.objects.create(user=self.user, name='Home')
        task = self.make_task('mix', 'chores #home #growth')
        stats = process_task_labels(self.user, creds=None)
        task.refresh_from_db()
        self.assertEqual(
            [label.name for label in task.labels.all()], ['Home']
        )
        self.assertEqual(stats['labels_assigned'], 1)
        self.assertEqual(
            [u['hashtag'] for u in stats['unmatched']], ['growth']
        )


class TasksApiTests(TestCase):
    """django-ninja layer at /api/tasks/ — auth contract, per-user
    isolation and mutation delegation to the existing views."""

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

    # --- session auth contract ---

    def test_unauthenticated_get_is_401_not_redirect(self):
        self.client.logout()
        resp = self.client.get(f'{self.API}/dashboard/')
        self.assertEqual(resp.status_code, 401)
        body = resp.json()
        self.assertEqual(body['error'], 'unauthenticated')
        self.assertTrue(
            body['login_url'].startswith('/admin/login/?next=')
        )

    def test_unauthenticated_post_is_401_not_redirect(self):
        self.client.logout()
        resp = self.client.post(
            f'{self.API}/tasks/reorder/',
            data=json.dumps({'updates': []}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()['error'], 'unauthenticated')

    def test_post_without_csrf_token_rejected(self):
        csrf_client = self.client.__class__(enforce_csrf_checks=True)
        csrf_client.force_login(self.user)
        resp = csrf_client.post(
            f'{self.API}/task/a/toggle-star/',
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()['error'], 'forbidden')

    def test_post_with_csrf_token_allowed(self):
        task = self.make_task('a')
        csrf_client = self.client.__class__(enforce_csrf_checks=True)
        csrf_client.force_login(self.user)
        csrf_client.cookies['csrftoken'] = 'x' * 32
        resp = csrf_client.post(
            f'{self.API}/task/a/toggle-star/',
            HTTP_X_CSRFTOKEN='x' * 32,
        )
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertTrue(task.is_starred)

    # --- google_reauth contract ---

    def test_auth_dict_result_returns_401_google_reauth(self):
        auth = {
            'authorization_url': (
                'https://accounts.google.com/o/oauth2/auth?x=1'
            ),
            'state': 'state-123',
            'scopes': ['https://www.googleapis.com/auth/tasks'],
        }
        with patch('google_tasks.views.get_creds_dict',
                   return_value={'token': 't'}), \
                patch('google_tasks.views.sync_all',
                      return_value=auth):
            resp = self.client.post(f'{self.API}/sync/')
        self.assertEqual(resp.status_code, 401)
        body = resp.json()
        self.assertEqual(body['error'], 'google_reauth')
        self.assertEqual(
            body['authorization_url'], auth['authorization_url']
        )
        # OAuth state stored in session exactly like the views do
        session = self.client.session
        self.assertEqual(session['state'], 'state-123')
        self.assertEqual(
            session['oauth_scopes'], auth['scopes']
        )

    def test_dead_credentials_return_401_google_reauth(self):
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
        body = resp.json()
        self.assertEqual(body['error'], 'google_reauth')
        self.assertIn('/login/', body['authorization_url'])

    def test_missing_credentials_mutation_returns_google_reauth(self):
        resp = self.client.post(f'{self.API}/sync/')
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()['error'], 'google_reauth')

    # --- reads ---

    def test_dashboard_shape_and_user_scoping(self):
        self.make_task('a', 1.0)
        self.make_task('done', 2.0, status='completed')
        self.make_task('bob-task', 1.0, user=self.other_user)
        resp = self.client.get(f'{self.API}/dashboard/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        ids = [t['task_id'] for t in body['tasks']]
        self.assertEqual(ids, ['a'])
        self.assertEqual(
            [t['task_id'] for t in body['completed']], ['done']
        )
        self.assertIn('needs_push', body['tasks'][0])
        self.assertIn('is_starred', body['tasks'][0])
        self.assertFalse(body['flags']['has_credentials'])

    def test_dashboard_list_and_label_filters(self):
        from google_tasks.models import TaskLabel
        label = TaskLabel.objects.create(user=self.user, name='Home')
        tagged = self.make_task('tagged', 1.0)
        tagged.labels.add(label)
        self.make_task('plain', 2.0)
        resp = self.client.get(f'{self.API}/dashboard/?label=Home')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(
            [t['task_id'] for t in body['tasks']], ['tagged']
        )
        self.assertEqual(body['selected_label'], 'Home')

    def test_task_detail_scoped_to_user(self):
        foreign = self.make_task(
            'foreign', user=self.other_user
        )
        resp = self.client.get(f'{self.API}/task/{foreign.task_id}/')
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()['error'], 'not_found')

    def test_task_detail_returns_task_schema(self):
        self.make_task('a', notes='n')
        resp = self.client.get(f'{self.API}/task/a/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['task']['task_id'], 'a')
        self.assertEqual(body['task']['notes'], 'n')
        self.assertEqual(body['task']['needs_push'], False)

    def test_search_matches_title(self):
        self.make_task('find me please', 1.0)
        self.make_task('other', 2.0)
        resp = self.client.get(f'{self.API}/search/?q=find+me')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['total_results'], 1)
        self.assertEqual(body['tasks'][0]['task_id'], 'find me please')

    # --- mutations ---

    def test_reorder_happy_path(self):
        a = self.make_task('a', 1.0)
        b = self.make_task('b', 2.0)
        resp = self.client.post(
            f'{self.API}/tasks/reorder/',
            data=json.dumps({'updates': [
                {'task_id': 'a', 'position': 2.0},
                {'task_id': 'b', 'position': 1.0},
            ]}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['success'])
        a.refresh_from_db()
        b.refresh_from_db()
        self.assertEqual(a.task_order, 2.0)
        self.assertEqual(b.task_order, 1.0)

    def test_reorder_other_users_task_is_400(self):
        self.make_task('foreign', 1.0, user=self.other_user)
        resp = self.client.post(
            f'{self.API}/tasks/reorder/',
            data=json.dumps({'updates': [
                {'task_id': 'foreign', 'position': 1.0},
            ]}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'bad_request')

    def test_reorder_invalid_payload_is_422(self):
        resp = self.client.post(
            f'{self.API}/tasks/reorder/',
            data=json.dumps({'updates': 'not-a-list'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 422)
        self.assertIn('detail', resp.json())

    def test_archive_and_permanent_delete(self):
        task = self.make_task('a')
        resp = self.client.post(f'{self.API}/task/a/archive/')
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertTrue(task.is_archived)
        resp = self.client.post(f'{self.API}/task/a/permanent-delete/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(
            GoogleTask.objects.filter(task_id='a').exists()
        )

    def test_process_labels_reports_unmatched_without_failing(self):
        """Unmatched hashtags used to 400 and abort the whole run;
        now the response stays 200 with stats.unmatched populated
        and every other task still gets processed."""
        GoogleTask.objects.create(
            user=self.user, task_id='bad',
            task_list=self.task_list,
            title='consultation #growth',
        )
        good = GoogleTask.objects.create(
            user=self.user, task_id='good',
            task_list=self.task_list,
            title='call bob #star',
        )
        with patch('google_tasks.views.get_creds_dict',
                   return_value={'token': 't'}):
            resp = self.client.post(f'{self.API}/process-labels/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['success'])
        self.assertEqual(
            body['stats']['unmatched'],
            [{'task_title': 'consultation #growth',
              'hashtag': 'growth'}],
        )
        good.refresh_from_db()
        self.assertTrue(good.is_starred)


class ReactAppShellTests(TestCase):
    """Post-cutover SPA mount: /tasks/ + catch-all serve the shell;
    /tasks/app/* 301-redirects; retired mutation URLs 404 on POST."""

    ENTRY_KEY = 'src/tasks/main.tsx'

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )

    def _write_manifest(self, tmpdir, contents):
        path = os.path.join(tmpdir, 'manifest.json')
        with open(path, 'w') as f:
            json.dump(contents, f)
        return path

    def _vite_override(self, manifest_path, dev_mode=False):
        return override_settings(DJANGO_VITE={
            'default': {
                'dev_mode': dev_mode,
                'dev_server_port': 5173,
                'static_url_prefix': '',
                'manifest_path': manifest_path,
            }
        })

    def test_requires_login(self):
        resp = self.client.get(reverse('google_tasks:dashboard'))
        self.assertEqual(resp.status_code, 302)

    def test_subpath_requires_login(self):
        resp = self.client.get('/tasks/starred/')
        self.assertEqual(resp.status_code, 302)

    def test_renders_shell_with_bootstrap(self):
        self.client.force_login(self.user)
        resp = self.client.get(reverse('google_tasks:dashboard'))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, 'id="root"')
        self.assertContains(resp, 'id="spa-bootstrap"')
        self.assertContains(resp, '"user": "alice"')

    def test_sets_csrf_cookie(self):
        # The React client's POSTs depend on the csrftoken cookie.
        self.client.force_login(self.user)
        resp = self.client.get(reverse('google_tasks:dashboard'))
        self.assertIn('csrftoken', resp.cookies)

    def test_subpath_renders_shell(self):
        self.client.force_login(self.user)
        resp = self.client.get('/tasks/starred/')
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, 'id="root"')

    def test_subpath_without_trailing_slash_renders(self):
        self.client.force_login(self.user)
        resp = self.client.get('/tasks/starred')
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, 'id="root"')

    def test_task_detail_subpath_renders_shell(self):
        self.client.force_login(self.user)
        resp = self.client.get('/tasks/task/abc123/')
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, 'id="root"')

    # --- /tasks/app/* legacy mount → permanent redirects ---

    def test_app_root_redirects_to_tasks_root(self):
        resp = self.client.get('/tasks/app/')
        self.assertEqual(resp.status_code, 301)
        self.assertEqual(resp['Location'], '/tasks/')

    def test_app_bare_redirects_without_append_slash_hop(self):
        # /tasks/app must not fall through to the SPA catch-all.
        resp = self.client.get('/tasks/app')
        self.assertEqual(resp.status_code, 301)
        self.assertEqual(resp['Location'], '/tasks/')

    def test_app_subpath_redirects(self):
        resp = self.client.get('/tasks/app/starred/')
        self.assertEqual(resp.status_code, 301)
        self.assertEqual(resp['Location'], '/tasks/starred/')

    def test_app_subpath_without_trailing_slash_redirects(self):
        resp = self.client.get('/tasks/app/starred')
        self.assertEqual(resp.status_code, 301)
        self.assertEqual(resp['Location'], '/tasks/starred')

    def test_app_redirect_preserves_query_string(self):
        resp = self.client.get('/tasks/app/?list=list-1&order=due_asc')
        self.assertEqual(resp.status_code, 301)
        self.assertEqual(
            resp['Location'], '/tasks/?list=list-1&order=due_asc'
        )

    def test_app_redirect_is_anonymous_friendly(self):
        # No login bounce on the redirect itself — the destination
        # view enforces auth after the hop.
        self.client.logout()
        resp = self.client.get('/tasks/app/starred/')
        self.assertEqual(resp.status_code, 301)

    # --- retired mutation routes ---

    def test_old_mutation_urls_404_on_post(self):
        self.client.force_login(self.user)
        for url in (
            '/tasks/sync/',
            '/tasks/tasks/reorder/',
            '/tasks/starred/reorder/',
            '/tasks/task/a/toggle-star/',
            '/tasks/task/a/complete/',
            '/tasks/task/a/archive/',
            '/tasks/task/a/delete/',
            '/tasks/divider/create/',
            '/tasks/process-labels/',
            '/tasks/task/create/',
        ):
            resp = self.client.post(
                url, data='{}', content_type='application/json'
            )
            self.assertEqual(resp.status_code, 404, url)

    # --- shell internals (unchanged by the move) ---

    def test_warns_when_manifest_missing(self):
        self.client.force_login(self.user)
        with self._vite_override('/nonexistent/manifest.json'):
            resp = self.client.get(reverse('google_tasks:dashboard'))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, 'React entry not loaded')

    def test_stale_manifest_renders_warning_not_500(self):
        # Manifest exists but the entry key is gone (renamed input,
        # partial build) — degrade to the warning, not a 500.
        self.client.force_login(self.user)
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest_path = self._write_manifest(tmpdir, {
                'src/renamed/main.tsx': {'file': 'x/x.deadbeef.js'},
            })
            with self._vite_override(manifest_path):
                resp = self.client.get(
                    reverse('google_tasks:dashboard'))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, 'React entry not loaded')

    def test_renders_entry_script_when_manifest_ready(self):
        # django-vite parses the manifest once into a singleton, so
        # patch the parsed entries rather than relying on re-reads.
        self.client.force_login(self.user)
        client = DjangoViteAssetLoader.instance()._apps['default']
        entry = ManifestEntry(
            file='tasks/tasks.abc12345.js',
            src=self.ENTRY_KEY,
            isEntry=True,
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest_path = self._write_manifest(
                tmpdir, {self.ENTRY_KEY: {'file': entry.file}})
            with self._vite_override(manifest_path), patch.dict(
                client.manifest._entries, {self.ENTRY_KEY: entry}
            ):
                resp = self.client.get(
                    reverse('google_tasks:dashboard'))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, 'tasks/tasks.abc12345.js')
        self.assertNotContains(resp, 'React entry not loaded')

    def test_dev_mode_renders_entry_without_manifest(self):
        # VITE_DEV flow: no manifest on disk, but dev_mode makes the
        # shell ready and vite_asset points at the dev server.
        self.client.force_login(self.user)
        client = DjangoViteAssetLoader.instance()._apps['default']
        with self._vite_override(
            '/nonexistent/manifest.json', dev_mode=True
        ), patch.object(client, 'dev_mode', True):
            resp = self.client.get(
                reverse('google_tasks:dashboard'))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, 'localhost:5173')
        self.assertNotContains(resp, 'React entry not loaded')

    def test_invalid_entry_raises_404(self):
        request = RequestFactory().get('/tasks/app/')
        request.user = self.user
        with self.assertRaises(Http404):
            spa_shell(request, entry='../escape')
