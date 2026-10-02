from contextlib import contextmanager
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from django.test import TestCase
from django.urls import reverse
from oauthlib.oauth2.rfc6749.errors import (
    AccessDeniedError,
    InvalidGrantError,
    MissingCodeError,
)

CALLBACK_URL = '/google/callback'


@contextmanager
def fetch_token_raising(exc):
    """Patch the InstalledAppFlow that callback() builds so
    fetch_token() raises `exc`."""
    with patch('google_api.utils.InstalledAppFlow') as flow_cls:
        flow = flow_cls.from_client_secrets_file.return_value
        flow.fetch_token.side_effect = exc
        yield flow


class OAuthCallbackTests(TestCase):
    """GET /google/callback with no usable auth code must bounce back
    into the OAuth login flow, not 500 — production bug: oauthlib's
    MissingCodeError was uncaught (user denied consent, pressed back,
    or opened the URL directly)."""

    def assert_login_redirect(self, resp, next_url=None):
        self.assertEqual(resp.status_code, 302)
        parsed = urlparse(resp.url)
        self.assertEqual(parsed.path, reverse('google_api:login'))
        if next_url:
            self.assertEqual(
                parse_qs(parsed.query)['next'], [next_url]
            )
        else:
            self.assertEqual(parsed.query, '')

    def test_missing_code_redirects_to_login(self):
        with fetch_token_raising(MissingCodeError()):
            resp = self.client.get(CALLBACK_URL)
        self.assert_login_redirect(resp)

    def test_access_denied_redirects_to_login_with_next(self):
        # Google sends ?error=access_denied (no code) when the user
        # denies consent — restart OAuth, preserving the original
        # oauth_redirect_url as ?next=.
        session = self.client.session
        session['oauth_redirect_url'] = '/gmail/?query=is%3Aunread'
        session.save()
        with fetch_token_raising(AccessDeniedError()):
            resp = self.client.get(
                f'{CALLBACK_URL}?error=access_denied'
            )
        self.assert_login_redirect(
            resp, next_url='/gmail/?query=is%3Aunread'
        )

    def test_invalid_grant_redirects_to_login(self):
        # Consumed/expired code (e.g. callback URL reloaded) was
        # already handled — keep it working after the merge.
        with fetch_token_raising(InvalidGrantError()):
            resp = self.client.get(CALLBACK_URL)
        self.assert_login_redirect(resp)
