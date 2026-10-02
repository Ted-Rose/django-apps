import json
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from googleapiclient.errors import HttpError
from httplib2 import Response as HttpLib2Response

from google_api.models import GoogleOAuthCredentials
from google_api.utils import AudioGenerationError
from gmail import services
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


def make_auth_dict(url='https://accounts.google.com/o/oauth2/auth?x=1',
                   scopes=None):
    return {
        'authorization_url': url,
        'state': 'state-123',
        'scopes': scopes or [GMAIL_READONLY_SCOPE],
    }


def make_http_error(status, message='Gmail API error'):
    """A googleapiclient HttpError with a real response status, like
    the errors Gmail's messages().list()/batchModify() raise."""
    resp = HttpLib2Response({
        'status': str(status),
        'content-type': 'application/json; charset=UTF-8',
    })
    body = json.dumps({
        'error': {
            'code': status,
            'message': message,
            'errors': [{'reason': 'insufficientPermissions'}],
        }
    })
    return HttpError(resp, body.encode('utf-8'))


def gmail_service_raising(error, method='list'):
    """A build() stand-in whose Gmail call raises `error`."""
    service = Mock()
    api_call = service.users().messages()
    getattr(api_call, method)().execute.side_effect = error
    return service


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

    def test_messages_gmail_403_maps_to_401_google_reauth(self):
        # Gmail itself rejects the token (e.g. scopes revoked after
        # the credential check passed) — the service must turn the
        # HttpError into the reauth dict, not a 500.
        auth = make_auth_dict()
        service = gmail_service_raising(make_http_error(403))
        with patch('gmail.api.get_user_credentials',
                   return_value=make_creds()), \
                patch('gmail.services.google_auth',
                      side_effect=[make_creds(), auth]), \
                patch('gmail.services.build', return_value=service):
            resp = self.client.get(f'{API}/messages/?query=is:unread')
        self.assertEqual(resp.status_code, 401)
        body = resp.json()
        self.assertEqual(body['error'], 'google_reauth')
        self.assertEqual(
            body['authorization_url'], auth['authorization_url']
        )
        self.assertEqual(self.client.session['state'], 'state-123')

    def test_messages_gmail_500_returns_empty_list(self):
        # Non-auth upstream failures degrade to an empty list.
        service = gmail_service_raising(make_http_error(500))
        with patch('gmail.api.get_user_credentials',
                   return_value=make_creds()), \
                patch('gmail.services.google_auth',
                      return_value=make_creds()), \
                patch('gmail.services.build', return_value=service):
            resp = self.client.get(f'{API}/messages/?query=x')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.json(), {'messages': [], 'query': 'x'}
        )

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

    def test_mark_read_gmail_403_maps_to_401_google_reauth(self):
        # batchModify rejects the token (insufficient scopes) — the
        # service returns the reauth dict instead of False so the
        # user is sent into the OAuth flow.
        auth = make_auth_dict(scopes=[GMAIL_MODIFY_SCOPE])
        service = gmail_service_raising(
            make_http_error(403), method='batchModify'
        )
        with patch('gmail.views.get_user_credentials',
                   return_value=make_creds([GMAIL_MODIFY_SCOPE])), \
                patch('gmail.services.google_auth',
                      side_effect=[make_creds([GMAIL_MODIFY_SCOPE]),
                                   auth]), \
                patch('gmail.services.build', return_value=service):
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


class GmailServicesTests(TestCase):
    """services.get_messages / mark_messages_as_read must survive
    Gmail API HttpErrors: auth failures (401/403) return the reauth
    dict, other failures degrade to [] / False — never
    UnboundLocalError."""

    CREDS = {
        'token': 'tok',
        'refresh_token': 'ref',
        'expiry': '2030-01-01T00:00:00',
        'scopes': [GMAIL_READONLY_SCOPE],
    }

    def test_get_messages_403_returns_reauth_dict(self):
        auth = make_auth_dict()
        service = gmail_service_raising(make_http_error(403))
        with patch('gmail.services.google_auth',
                   side_effect=[make_creds(), auth]) as auth_mock, \
                patch('gmail.services.build', return_value=service):
            result = services.get_messages(
                query='is:unread', creds=self.CREDS
            )
        self.assertEqual(result, auth)
        # The follow-up google_auth call asks for the readonly scope.
        self.assertEqual(auth_mock.call_count, 2)
        self.assertEqual(
            auth_mock.call_args.kwargs['scopes'],
            [GMAIL_READONLY_SCOPE],
        )

    def test_get_messages_401_returns_reauth_dict(self):
        auth = make_auth_dict()
        service = gmail_service_raising(make_http_error(401))
        with patch('gmail.services.google_auth',
                   side_effect=[make_creds(), auth]), \
                patch('gmail.services.build', return_value=service):
            result = services.get_messages(query='x', creds=self.CREDS)
        self.assertEqual(result, auth)

    def test_get_messages_500_returns_empty_list(self):
        service = gmail_service_raising(make_http_error(500))
        with patch('gmail.services.google_auth',
                   return_value=make_creds()), \
                patch('gmail.services.build', return_value=service):
            result = services.get_messages(query='x', creds=self.CREDS)
        self.assertEqual(result, [])

    def test_mark_read_403_returns_reauth_dict(self):
        auth = make_auth_dict(scopes=[GMAIL_MODIFY_SCOPE])
        service = gmail_service_raising(
            make_http_error(403), method='batchModify'
        )
        with patch('gmail.services.google_auth',
                   side_effect=[
                       make_creds([GMAIL_MODIFY_SCOPE]), auth
                   ]) as auth_mock, \
                patch('gmail.services.build', return_value=service):
            result = services.mark_messages_as_read(
                self.CREDS, ['m1', 'm2']
            )
        self.assertEqual(result, auth)
        self.assertEqual(auth_mock.call_count, 2)
        self.assertEqual(
            auth_mock.call_args.kwargs['scopes'],
            [GMAIL_MODIFY_SCOPE],
        )

    def test_mark_read_500_returns_false(self):
        service = gmail_service_raising(
            make_http_error(500), method='batchModify'
        )
        with patch('gmail.services.google_auth',
                   return_value=make_creds([GMAIL_MODIFY_SCOPE])), \
                patch('gmail.services.build', return_value=service):
            result = services.mark_messages_as_read(
                self.CREDS, ['m1']
            )
        self.assertFalse(result)
