import base64
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
from gmail.models import EmailParsingRule
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


def gmail_service_with_raw(raw, message_id='m1'):
    """A build() stand-in serving one raw RFC 822 message."""
    service = Mock()
    api_call = service.users().messages()
    api_call.list().execute.return_value = {
        'messages': [{'id': message_id}]
    }
    api_call.get().execute.return_value = {
        'raw': base64.urlsafe_b64encode(raw).decode('ascii')
    }
    return service


def raw_message(sender='Sender <s@example.lv>', subject='Hi',
                body='Hello', content_type='text/plain',
                charset='utf-8'):
    """A single-part RFC 822 message as bytes."""
    headers = (
        f'From: {sender}\r\n'
        f'Subject: {subject}\r\n'
        'MIME-Version: 1.0\r\n'
        f'Content-Type: {content_type}; charset="{charset}"\r\n'
        '\r\n'
    ).encode('ascii')
    return headers + body.encode(charset)


def nested_multipart_message():
    """multipart/mixed → [multipart/alternative → [plain, html],
    pdf attachment] — the standard shape for mail with attachments,
    which the old top-level iter_parts() loop couldn't see into."""
    return (
        'From: Optio <info@optio.example>\r\n'
        'Subject: Invoice\r\n'
        'MIME-Version: 1.0\r\n'
        'Content-Type: multipart/mixed; boundary="MIX"\r\n'
        '\r\n'
        '--MIX\r\n'
        'Content-Type: multipart/alternative; boundary="ALT"\r\n'
        '\r\n'
        '--ALT\r\n'
        'Content-Type: text/plain; charset="utf-8"\r\n'
        '\r\n'
        'Labdien, rēķins pievienots.\r\n'
        '--ALT\r\n'
        'Content-Type: text/html; charset="utf-8"\r\n'
        '\r\n'
        '<p>Labdien, <b>rēķins</b> pievienots.</p>\r\n'
        '--ALT--\r\n'
        '--MIX\r\n'
        'Content-Type: application/pdf; name="inv.pdf"\r\n'
        'Content-Transfer-Encoding: base64\r\n'
        'Content-Disposition: attachment\r\n'
        '\r\n'
        'QUJD\r\n'
        '--MIX--\r\n'
    ).encode('utf-8')


def cp1257_message():
    """A windows-1257 text/plain part inside multipart/mixed — the
    old code decoded it with the (absent → utf-8) top-level charset
    and produced \\ufffd mojibake."""
    headers = (
        b'From: Baltic <b@example.lv>\r\n'
        b'Subject: Baltic\r\n'
        b'MIME-Version: 1.0\r\n'
        b'Content-Type: multipart/mixed; boundary="X"\r\n'
        b'\r\n'
        b'--X\r\n'
        b'Content-Type: text/plain; charset="windows-1257"\r\n'
        b'Content-Transfer-Encoding: 8bit\r\n'
        b'\r\n'
    )
    body = 'Pērle šodien'.encode('cp1257')
    return headers + body + b'\r\n--X--\r\n'


EKLASE_SENDER = 'e-klase <notifikacijas@e-klase.lv>'
EKLASE_BODY = (
    'No: a Tēma: Atzīmes No: b Kam: Vecāks '
    'Lai aplūkotu pielikumus, pieslēdzieties E-klasei. '
    'Īsā vēstule. ' + '_' * 60 + 'Lai atbildētu vai pārsūtītu'
)


def make_rule(user, **kwargs):
    defaults = {
        'name': 'rule',
        'sender_pattern': 'e-klase',
    }
    defaults.update(kwargs)
    return EmailParsingRule.objects.create(user=user, **defaults)


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
            'body': 'hello', 'lang': None,
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
        # The endpoint hands the user's active rules to the service.
        self.assertEqual(get.call_args.kwargs['rules'], [])

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

    def test_audio_passes_lang_through_to_text_to_audio(self):
        # The rule's force_language hint arrives as ?lang= and must
        # reach text_to_audio so detection is skipped server-side.
        with patch('gmail.api.text_to_audio',
                   return_value='https://signed.example/x.mp3') as tts:
            resp = self.client.get(
                f'{API}/audio/?text=Labdien&lang=lv&filename=m1'
            )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(tts.call_args.kwargs['lang'], 'lv')
        self.assertEqual(tts.call_args.kwargs['filename'], 'm1')


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


class GmailMimeParsingTests(TestCase):
    """Phase 1 fixes: get_body() descends nested multiparts, each
    part decodes with its own charset, extract_text_from_html drops
    style/script contents and unescapes entities."""

    CREDS = GmailServicesTests.CREDS

    def fetch(self, raw, rules=None):
        service = gmail_service_with_raw(raw)
        with patch('gmail.services.google_auth',
                   return_value=make_creds()), \
                patch('gmail.services.build', return_value=service):
            return services.get_messages(
                query='x', creds=self.CREDS, rules=rules
            )

    def test_nested_mixed_alternative_yields_plain_body(self):
        # multipart/mixed → multipart/alternative used to fall
        # through the top-level scan into 'Multipart message
        # without text part!' — an English sentence read aloud.
        [msg] = self.fetch(nested_multipart_message())
        self.assertEqual(msg['subject'], 'Invoice')
        self.assertEqual(msg['body'], 'Labdien, rēķins pievienots.')
        self.assertIsNone(msg['lang'])

    def test_nested_alternative_without_plain_uses_html(self):
        raw = (
            b'From: A <a@b.c>\r\nSubject: Html\r\n'
            b'MIME-Version: 1.0\r\n'
            b'Content-Type: multipart/alternative; boundary="A"\r\n'
            b'\r\n--A\r\n'
            b'Content-Type: text/html; charset="utf-8"\r\n\r\n'
            b'<p>Sveiki</p>\r\n--A--\r\n'
        )
        [msg] = self.fetch(raw)
        self.assertEqual(msg['body'], 'Sveiki')

    def test_attachment_only_message_has_empty_body(self):
        # No text part at all → '' (never the English placeholder).
        raw = (
            b'From: A <a@b.c>\r\nSubject: Files\r\n'
            b'MIME-Version: 1.0\r\n'
            b'Content-Type: multipart/mixed; boundary="X"\r\n\r\n'
            b'--X\r\n'
            b'Content-Type: application/pdf\r\n'
            b'Content-Transfer-Encoding: base64\r\n\r\n'
            b'QUJD\r\n--X--\r\n'
        )
        [msg] = self.fetch(raw)
        self.assertEqual(msg['body'], '')

    def test_part_decoded_with_its_own_charset(self):
        [msg] = self.fetch(cp1257_message())
        self.assertEqual(msg['body'], 'Pērle šodien')

    def test_html_body_drops_style_script_and_unescapes(self):
        raw = raw_message(
            content_type='text/html',
            body=(
                '<html><head><style>.msg-body p{color:red}</style>'
                '</head><body><script>var x = 1;</script>'
                '<p>Sveiki&nbsp;<b>pasaule</b></p></body></html>'
            ),
        )
        [msg] = self.fetch(raw)
        self.assertEqual(msg['body'], 'Sveiki pasaule')

    def test_extract_text_from_html_collapses_whitespace(self):
        self.assertEqual(
            services.extract_text_from_html('<p>a</p>\n\n<p>b</p>'),
            'a b',
        )


class EmailParsingRuleTests(TestCase):
    """Phase 2: per-user EmailParsingRules applied inside
    get_messages — first sender match (priority, pk) wins; the
    hardcoded e-klase parse remains the no-rule fallback."""

    CREDS = GmailServicesTests.CREDS

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )

    def fetch(self, raw):
        rules = services.active_rules_for(self.user)
        service = gmail_service_with_raw(raw)
        with patch('gmail.services.google_auth',
                   return_value=make_creds()), \
                patch('gmail.services.build', return_value=service):
            return services.get_messages(
                query='x', creds=self.CREDS, rules=rules
            )

    def eklase_raw(self):
        return raw_message(
            sender=EKLASE_SENDER, subject='E-klase',
            body=EKLASE_BODY,
        )

    def test_sender_match_types(self):
        cases = [
            ('contains', 'e-klase', True),
            # Match is case-insensitive, like CategoryRule's.
            ('contains', 'E-KLASE', True),
            ('contains', 'skola.lv', False),
            ('equals', EKLASE_SENDER, True),
            ('equals', 'e-klase', False),
            ('starts_with', 'e-klase <', True),
            ('starts_with', 'notifikacijas', False),
            ('ends_with', 'e-klase.lv>', True),
            ('ends_with', 'e-klase', False),
        ]
        for match_type, pattern, expected in cases:
            with self.subTest(match_type=match_type, pattern=pattern):
                rule = make_rule(
                    self.user, sender_pattern=pattern,
                    sender_match_type=match_type,
                )
                self.assertIs(
                    services._sender_matches(rule, EKLASE_SENDER),
                    expected,
                )

    def test_first_matching_rule_wins_by_priority(self):
        make_rule(self.user, name='later', priority=200,
                  force_language='lv')
        first = make_rule(self.user, name='first', priority=50,
                          force_language='en')
        rule = services._first_matching_rule(
            services.active_rules_for(self.user), EKLASE_SENDER
        )
        self.assertEqual(rule.pk, first.pk)

    def test_same_priority_wins_by_pk(self):
        first = make_rule(self.user, name='a')
        make_rule(self.user, name='b')
        rule = services._first_matching_rule(
            services.active_rules_for(self.user), EKLASE_SENDER
        )
        self.assertEqual(rule.pk, first.pk)

    def test_inactive_rules_are_skipped(self):
        make_rule(self.user, is_active=False, force_language='lv')
        self.assertEqual(services.active_rules_for(self.user), [])
        # ...so the e-klase fallback still applies.
        [msg] = self.fetch(self.eklase_raw())
        self.assertEqual(msg['subject'], 'Atzīmes')
        self.assertIsNone(msg['lang'])

    def test_eklase_fallback_when_no_rules(self):
        [msg] = self.fetch(self.eklase_raw())
        self.assertEqual(msg['subject'], 'Atzīmes')
        self.assertEqual(msg['body'], 'Īsā vēstule.')
        self.assertIsNone(msg['lang'])

    def test_rule_extracts_strips_and_forces_language(self):
        make_rule(
            self.user,
            sender_pattern='optio.example',
            force_language='lv',
            subject_regex=r'Tēma: (.*?)(?=No:)',
            body_regex=r'Kam: ([\s\S]*?)(?=BEIGAS)',
            strip_patterns=[
                r'Vēstulei pievienoti dokumenti:\s*\S+',
            ],
        )
        raw = raw_message(
            sender='Optio <i@optio.example>', subject='orig',
            body=(
                'No: x Tēma: Rēķins No: y Kam: Klients Saturs. '
                'Vēstulei pievienoti dokumenti: inv.pdf BEIGAS'
            ),
        )
        [msg] = self.fetch(raw)
        # subject_regex searched the body, like the e-klase parse.
        self.assertEqual(msg['subject'], 'Rēķins')
        self.assertEqual(msg['body'], 'Klients Saturs.')
        self.assertEqual(msg['lang'], 'lv')

    def test_matching_user_rule_replaces_eklase_fallback(self):
        make_rule(
            self.user, sender_pattern='e-klase',
            force_language='lv',
            body_regex=r'Kam: ([\s\S]*?)(?=_+Lai)',
        )
        [msg] = self.fetch(self.eklase_raw())
        # The user rule's body_regex won over the hardcoded parse —
        # the fallback would have stripped 'Lai aplūkotu…'.
        self.assertIn('Lai aplūkotu', msg['body'])
        self.assertEqual(msg['lang'], 'lv')
        # force_language surfaced, but subject_regex was empty so
        # the header subject is kept.
        self.assertEqual(msg['subject'], 'E-klase')

    def test_invalid_rule_regex_is_logged_and_skipped(self):
        make_rule(
            self.user, subject_regex='([', body_regex='(*',
            strip_patterns=['[unclosed'],
        )
        raw = raw_message(
            sender=EKLASE_SENDER, subject='Hi', body='teksts'
        )
        [msg] = self.fetch(raw)
        self.assertEqual(msg['subject'], 'Hi')
        self.assertEqual(msg['body'], 'teksts')

    def test_non_participating_group_uses_next_group(self):
        # '(foo)|(bar)' matching 'bar' leaves group(1) None —
        # group(1).strip() used to AttributeError, 500ing the
        # whole fetch; now the next participating group wins.
        make_rule(self.user, body_regex=r'(foo)|(bar)')
        raw = raw_message(
            sender=EKLASE_SENDER, subject='Hi', body='say bar here'
        )
        [msg] = self.fetch(raw)
        self.assertEqual(msg['body'], 'bar')

    def test_no_participating_group_uses_whole_match(self):
        # 'ba(r)?' matching 'ba' has no participating group at all
        # — extraction falls back to match.group(0).
        make_rule(self.user, body_regex=r'ba(r)?')
        raw = raw_message(
            sender=EKLASE_SENDER, subject='Hi', body='ba ba'
        )
        [msg] = self.fetch(raw)
        self.assertEqual(msg['body'], 'ba')

    def test_strip_patterns_skips_non_string_entries(self):
        make_rule(self.user, strip_patterns=[123, None, 'zzz'])
        raw = raw_message(
            sender=EKLASE_SENDER, subject='Hi', body='teksts zzz'
        )
        [msg] = self.fetch(raw)
        # 'zzz' still strips; the non-string entries are skipped
        # instead of TypeError-ing the whole fetch.
        self.assertEqual(msg['body'], 'teksts')

    def test_strip_patterns_plain_string_value_ignored(self):
        # A non-list JSON value must not be iterated
        # character-by-character (each char a regex — that would
        # gut the body).
        make_rule(self.user, strip_patterns='teksts')
        raw = raw_message(
            sender=EKLASE_SENDER, subject='Hi', body='teksts vēl'
        )
        [msg] = self.fetch(raw)
        self.assertEqual(msg['body'], 'teksts vēl')

    def test_broken_rule_degrades_message_not_response(self):
        # Through the API: a rule that would previously have
        # raised mid-extraction must leave the response intact —
        # that message just gets degraded extraction, not a 500.
        make_rule(
            self.user, body_regex=r'(foo)|(bar)',
            strip_patterns='not a list',
        )
        self.client.force_login(self.user)
        service = gmail_service_with_raw(
            raw_message(
                sender=EKLASE_SENDER, subject='Hi', body='x bar y'
            )
        )
        with patch('gmail.api.get_user_credentials',
                   return_value=make_creds()), \
                patch('gmail.services.google_auth',
                      return_value=make_creds()), \
                patch('gmail.services.build', return_value=service):
            resp = self.client.get(f'{API}/messages/?query=x')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.json()['messages'][0]['body'], 'bar'
        )

    def test_lang_hint_in_messages_api_response(self):
        make_rule(self.user, sender_pattern='optio',
                  force_language='lv')
        self.client.force_login(self.user)
        service = gmail_service_with_raw(
            raw_message(sender='Optio <i@optio.example>')
        )
        with patch('gmail.api.get_user_credentials',
                   return_value=make_creds()), \
                patch('gmail.services.google_auth',
                      return_value=make_creds()), \
                patch('gmail.services.build', return_value=service):
            resp = self.client.get(f'{API}/messages/?query=x')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['messages'][0]['lang'], 'lv')
