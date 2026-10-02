import json
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from google_api.models import GoogleOAuthCredentials
from google_api.utils import AudioGenerationError
from gmail.services import GMAIL_MODIFY_SCOPE, GMAIL_READONLY_SCOPE

API = '/api/gmail'


def make_creds(scopes=None):
    """A duck-typed Credentials stand-in for get_user_credentials."""
    return SimpleNamespace(
        token='tok',
        refresh_token='ref',
        expiry=timezone.now(),
        scopes=scopes or [GMAIL_READONLY_SCOPE],
    )


def make_auth_dict(url='https://accounts.google.com/o/oauth2/auth?x=1'):
    return {
        'authorization_url': url,
        'state': 'state-123',
        'scopes': [GMAIL_READONLY_SCOPE],
    }


class GmailApiTests(TestCase):
    """The /api/gmail/ contract: session auth, google_reauth bounce,
    OAuth session-state writes, view delegation and audio errors."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.client.force_login(self.user)

    # --- session auth contract ---

    def test_unauthenticated_get_is_401_not_redirect(self):
        self.client.logout()
        for url in (f'{API}/status/', f'{API}/messages/'):
            resp = self.client.get(url)
            self.assertEqual(resp.status_code, 401)
            self.assertEqual(resp.json()['error'], 'unauthenticated')

    def test_unauthenticated_post_is_401_not_redirect(self):
        self.client.logout()
        resp = self.client.post(
            f'{API}/mark-read/',
            data=json.dumps({'message_ids': ['a']}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()['error'], 'unauthenticated')

    def test_post_without_csrf_token_rejected(self):
        csrf_client = self.client.__class__(enforce_csrf_checks=True)
        csrf_client.force_login(self.user)
        resp = csrf_client.post(
            f'{API}/mark-read/',
            data=json.dumps({'message_ids': ['a']}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    # --- status ---

    def test_status_without_credentials_row(self):
        resp = self.client.get(f'{API}/status/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.json(), {'has_credentials': False, 'scopes': []}
        )

    def test_status_with_usable_credentials(self):
        GoogleOAuthCredentials.objects.create(
            user=self.user,
            access_token='tok',
            refresh_token='ref',
            token_expiry=timezone.now(),
            scopes=[GMAIL_READONLY_SCOPE, GMAIL_MODIFY_SCOPE],
        )
        with patch('gmail.api.get_user_credentials',
                   return_value=make_creds()):
            resp = self.client.get(f'{API}/status/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {
            'has_credentials': True,
            'scopes': [GMAIL_READONLY_SCOPE, GMAIL_MODIFY_SCOPE],
        })

    def test_status_with_dead_credentials(self):
        GoogleOAuthCredentials.objects.create(
            user=self.user,
            access_token='dead',
            refresh_token='dead',
            token_expiry=timezone.now(),
            scopes=[GMAIL_READONLY_SCOPE],
        )
        with patch('gmail.api.get_user_credentials',
                   return_value=None):
            resp = self.client.get(f'{API}/status/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['has_credentials'], False)

    # --- messages ---

    def test_messages_without_credentials_is_401_google_reauth(self):
        resp = self.client.get(f'{API}/messages/?query=is:unread')
        self.assertEqual(resp.status_code, 401)
        body = resp.json()
        self.assertEqual(body['error'], 'google_reauth')
        # The login bounce must send the user back to the SPA page,
        # not to this /api/ JSON URL — spa_url_for collapses the
        # single-page app's subpath to /gmail/ and keeps the query.
        parsed = urlparse(body['authorization_url'])
        self.assertEqual(parsed.path, '/login/')
        self.assertEqual(
            parse_qs(parsed.query)['next'],
            ['/gmail/?query=is%3Aunread'],
        )

    def test_messages_with_dead_credentials_is_401_google_reauth(self):
        GoogleOAuthCredentials.objects.create(
            user=self.user,
            access_token='dead',
            refresh_token='dead',
            token_expiry=timezone.now(),
            scopes=[GMAIL_READONLY_SCOPE],
        )
        with patch('gmail.api.get_user_credentials',
                   return_value=None):
            resp = self.client.get(f'{API}/messages/?query=x')
        self.assertEqual(resp.status_code, 401)
        body = resp.json()
        self.assertEqual(body['error'], 'google_reauth')
        self.assertIn('/login/', body['authorization_url'])

    def test_messages_auth_dict_stores_session_and_returns_401(self):
        auth = make_auth_dict()
        with patch('gmail.api.get_user_credentials',
                   return_value=make_creds()), \
                patch('gmail.services.get_messages',
                      return_value=auth):
            resp = self.client.get(f'{API}/messages/?query=is:unread')
        self.assertEqual(resp.status_code, 401)
        body = resp.json()
        self.assertEqual(body['error'], 'google_reauth')
        self.assertEqual(
            body['authorization_url'], auth['authorization_url']
        )
        session = self.client.session
        self.assertEqual(session['state'], 'state-123')
        self.assertEqual(session['oauth_scopes'], auth['scopes'])
        # The OAuth callback returns to the SPA page (query intact),
        # not to an /api/ JSON URL.
        self.assertEqual(
            session['oauth_redirect_url'], '/gmail/?query=is%3Aunread'
        )

    def test_messages_success_shape(self):
        msgs = [{
            'id': 'm1', 'subject': 'Hi', 'sender': 'a@b.c',
            'body': 'hello',
        }]
        with patch('gmail.api.get_user_credentials',
                   return_value=make_creds()), \
                patch('gmail.services.get_messages',
                      return_value=msgs) as get:
            resp = self.client.get(f'{API}/messages/?query=is:unread')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {
            'messages': msgs, 'query': 'is:unread',
        })
        self.assertEqual(get.call_args.kwargs['query'], 'is:unread')

    # --- mark-read (delegates to gmail.views.mark_emails_read) ---

    def test_mark_read_success(self):
        with patch('gmail.views.get_user_credentials',
                   return_value=make_creds([GMAIL_MODIFY_SCOPE])), \
                patch('gmail.views.mark_messages_as_read',
                      return_value=True) as mark:
            resp = self.client.post(
                f'{API}/mark-read/',
                data=json.dumps({'message_ids': ['m1', 'm2']}),
                content_type='application/json',
            )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {'success': True})
        self.assertEqual(mark.call_args.args[1], ['m1', 'm2'])

    def test_mark_read_empty_list_is_400(self):
        resp = self.client.post(
            f'{API}/mark-read/',
            data=json.dumps({'message_ids': []}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)
        # The view's error body passes through _adapt verbatim.
        self.assertIn('non-empty', resp.json()['error'])

    def test_mark_read_reauth_payload_maps_to_401(self):
        auth = make_auth_dict()
        with patch('gmail.views.get_user_credentials',
                   return_value=None), \
                patch('gmail.views.google_auth', return_value=auth):
            resp = self.client.post(
                f'{API}/mark-read/',
                data=json.dumps({'message_ids': ['m1']}),
                content_type='application/json',
            )
        self.assertEqual(resp.status_code, 401)
        body = resp.json()
        self.assertEqual(body['error'], 'google_reauth')
        self.assertEqual(
            body['authorization_url'], auth['authorization_url']
        )
        # _gmail_reauth_response stored OAuth state in the session.
        self.assertEqual(self.client.session['state'], 'state-123')

    # --- audio ---

    def test_audio_returns_signed_url(self):
        with patch('gmail.api.text_to_audio',
                   return_value='https://signed.example/x.mp3'):
            resp = self.client.get(
                f'{API}/audio/?text=hello&filename=m1'
            )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.json(), {'audio_url': 'https://signed.example/x.mp3'}
        )

    def test_audio_value_error_is_400(self):
        with patch('gmail.api.text_to_audio',
                   side_effect=ValueError('Text too long')):
            resp = self.client.get(f'{API}/audio/?text=x')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'bad_request')

    def test_audio_pipeline_error_is_502(self):
        with patch('gmail.api.text_to_audio',
                   side_effect=AudioGenerationError('no bucket')):
            resp = self.client.get(f'{API}/audio/?text=x')
        self.assertEqual(resp.status_code, 502)
        self.assertEqual(resp.json()['error'], 'upstream_error')


class GmailCutoverRouteTests(TestCase):
    """Stage 5 cutover routing: /gmail/ is the SPA, the legacy URLs
    are gone (redirect / 404)."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )

    def test_legacy_url_301s_to_spa_preserving_query(self):
        resp = self.client.get(
            '/gmail-to-audio?get_messages&query=is:unread'
        )
        self.assertEqual(resp.status_code, 301)
        parsed = urlparse(resp.url)
        self.assertEqual(parsed.path, '/gmail/')
        # keep_blank_values: the legacy ?get_messages flag has no '=',
        # so it round-trips as 'get_messages=' in the Location header.
        query = parse_qs(parsed.query, keep_blank_values=True)
        self.assertEqual(query['query'], ['is:unread'])
        self.assertIn('get_messages', query)

    def test_legacy_redirect_is_not_login_gated(self):
        # app_redirect deliberately skips @login_required so
        # anonymous users hit the SPA's own login bounce at the
        # destination, not a double hop.
        self.client.logout()
        resp = self.client.get('/gmail-to-audio')
        self.assertEqual(resp.status_code, 301)
        self.assertEqual(urlparse(resp.url).path, '/gmail/')

    def test_spa_mount_serves_shell_for_authed_user(self):
        self.client.force_login(self.user)
        resp = self.client.get('/gmail/')
        self.assertEqual(resp.status_code, 200)
        self.assertTemplateUsed(resp, 'spa_shell.html')

    def test_spa_deep_link_serves_shell(self):
        self.client.force_login(self.user)
        resp = self.client.get('/gmail/reader/anything')
        self.assertEqual(resp.status_code, 200)
        self.assertTemplateUsed(resp, 'spa_shell.html')

    def test_spa_mount_is_login_gated(self):
        self.client.logout()
        resp = self.client.get('/gmail/')
        self.assertEqual(resp.status_code, 302)
        self.assertIn('/login/?next=', resp.url)

    def test_non_get_to_spa_mount_404s(self):
        self.client.force_login(self.user)
        resp = self.client.post('/gmail/')
        self.assertEqual(resp.status_code, 404)

    def test_gmail_mark_read_route_is_gone(self):
        self.client.force_login(self.user)
        resp = self.client.post(
            '/gmail-mark-read',
            data=json.dumps({'message_ids': ['m1']}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 404)

    def test_index_name_reverses_to_spa(self):
        from django.urls import reverse
        self.assertEqual(reverse('gmail:index'), '/gmail/')
        self.assertEqual(reverse('gmail:legacy'), '/gmail-to-audio')
