"""Tests for the Sentry wiring: ``sentry_before_send`` scrubbing,
the DSN-gated ``capture_internal_exception``, and the ninja
``Exception`` catch-all that reports swallowed API bugs (uniform
500 body + Sentry capture + a traceback-carrying log line)."""
import json
import sys
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from django_apps.api import _on_server_error
from django_apps.sentry import (
    capture_internal_exception,
    sentry_before_send,
)


class SentryBeforeSendTests(SimpleTestCase):
    """Credential-path request data must never leave the server."""

    def _event(self, url):
        return {
            'request': {
                'url': url,
                'method': 'POST',
                'data': {'username': 'u', 'password': 'secret'},
            }
        }

    def test_login_path_body_is_dropped(self):
        event = sentry_before_send(
            self._event('https://app.example.com/login/'), None
        )

        self.assertNotIn('data', event['request'])
        self.assertEqual(event['request']['method'], 'POST')

    def test_admin_login_path_body_is_dropped(self):
        # /admin/login/ is the only real password POST.
        event = sentry_before_send(
            self._event('https://app.example.com/admin/login/'), None
        )

        self.assertNotIn('data', event['request'])

    def test_other_paths_keep_the_body(self):
        body = {'username': 'u', 'password': 'secret'}
        event = sentry_before_send(
            self._event('https://app.example.com/api/me/'), None
        )

        self.assertEqual(event['request']['data'], body)

    def test_oauth_callback_drops_the_query_string(self):
        # The single-use authorization `code` is a credential —
        # it must not persist in event URLs.
        event = sentry_before_send(
            self._event(
                'https://app.example.com/google/callback'
                '?code=abc123&state=xyz'
            ),
            None,
        )

        self.assertEqual(
            event['request']['url'],
            'https://app.example.com/google/callback',
        )

    def test_other_paths_keep_the_query_string(self):
        event = sentry_before_send(
            self._event('https://app.example.com/api/me/?x=1'), None
        )

        self.assertEqual(
            event['request']['url'],
            'https://app.example.com/api/me/?x=1',
        )

    def test_missing_request_block_is_tolerated(self):
        self.assertEqual(sentry_before_send({}, None), {})

    def test_non_dict_request_block_is_tolerated(self):
        event = {'request': 'not-a-dict'}

        self.assertIs(sentry_before_send(event, None), event)


class CaptureInternalExceptionTests(SimpleTestCase):
    """Sentry is optional — a missing SDK or DSN must not break
    the request/job path that calls ``capture_internal_exception``."""

    def test_noops_when_sentry_sdk_is_missing(self):
        # None in sys.modules forces ImportError on the lazy import.
        with patch.dict(sys.modules, {'sentry_sdk': None}):
            capture_internal_exception(RuntimeError('boom'))

    def test_captures_with_tag_at_error_level(self):
        sdk = MagicMock()
        scope = sdk.new_scope.return_value.__enter__.return_value
        with patch.dict(sys.modules, {'sentry_sdk': sdk}):
            capture_internal_exception(RuntimeError('boom'))

        scope.set_tag.assert_called_once_with(
            'error_code', 'internal_error'
        )
        sdk.capture_exception.assert_called_once()
        args, kwargs = sdk.capture_exception.call_args
        self.assertIsInstance(args[0], RuntimeError)
        self.assertEqual(kwargs.get('level'), 'error')


class ServerErrorHandlerTests(SimpleTestCase):
    """The ninja ``Exception`` handler keeps the uniform 500
    contract AND reports the swallowed exception — Sentry capture
    alone is not enough (a traceback must reach the logs too,
    since Sentry may be unconfigured)."""

    def test_500_body_capture_and_traceback_log(self):
        request = RequestFactory().get('/api/me/')
        try:
            raise RuntimeError('boom')
        except RuntimeError as exc:
            # The handler must run inside `except` so the traceback
            # is live on sys.exc_info() for logger.exception.
            with patch(
                'django_apps.api.capture_internal_exception'
            ) as mock_capture, self.assertLogs(
                'django', level='ERROR'
            ) as cm:
                response = _on_server_error(request, exc)
            mock_capture.assert_called_once_with(exc)

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            json.loads(response.content),
            {
                'error': 'server_error',
                'detail': 'Internal Server Error',
            },
        )
        # The log record carries the real traceback, not just a
        # message — that's the whole point of logging here.
        self.assertIs(cm.records[0].exc_info[0], RuntimeError)
