"""Tests for the Sentry wiring: ``sentry_before_send`` scrubbing,
the DSN-gated ``capture_internal_exception`` /
``capture_provider_exception``, and the ninja ``Exception``
catch-all that reports swallowed API bugs (uniform 500 body +
Sentry capture + a traceback-carrying log line)."""
import json
import sys
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from django_apps.api import _on_server_error
from django_apps.sentry import (
    capture_internal_exception,
    capture_provider_exception,
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

    def test_extra_tags_are_set_on_the_scope(self):
        sdk = MagicMock()
        scope = sdk.new_scope.return_value.__enter__.return_value
        with patch.dict(sys.modules, {'sentry_sdk': sdk}):
            capture_internal_exception(
                RuntimeError('boom'), tags={'job': 'all_jobs'}
            )

        scope.set_tag.assert_any_call('error_code', 'internal_error')
        scope.set_tag.assert_any_call('job', 'all_jobs')


class _FakeHttpError(Exception):
    """googleapiclient.HttpError stand-in — status on ``resp``."""

    def __init__(self, status):
        super().__init__('http error')
        self.resp = MagicMock(status=status)


class _FakeResponseError(Exception):
    """requests/pywebpush stand-in — status on ``response``."""

    def __init__(self, status):
        super().__init__('request error')
        self.response = MagicMock(status_code=status)


class CaptureProviderExceptionTests(SimpleTestCase):
    """Caught upstream failures trend at ``warning`` under an
    ``error_code`` allowlist — routine handled outcomes never
    reach Sentry at all."""

    def _capture(self, exc, **kwargs):
        sdk = MagicMock()
        scope = sdk.new_scope.return_value.__enter__.return_value
        with patch.dict(sys.modules, {'sentry_sdk': sdk}):
            capture_provider_exception(exc, **kwargs)
        return sdk, scope

    def test_noops_when_sentry_sdk_is_missing(self):
        with patch.dict(sys.modules, {'sentry_sdk': None}):
            capture_provider_exception(RuntimeError('boom'))

    def test_captures_at_warning_with_provider_error_tag(self):
        sdk, scope = self._capture(RuntimeError('boom'))

        scope.set_tag.assert_called_once_with(
            'error_code', 'provider_error'
        )
        args, kwargs = sdk.capture_exception.call_args
        self.assertIsInstance(args[0], RuntimeError)
        self.assertEqual(kwargs.get('level'), 'warning')

    def test_429_maps_to_rate_limited(self):
        _, scope = self._capture(_FakeHttpError(429))

        scope.set_tag.assert_called_once_with(
            'error_code', 'rate_limited'
        )

    def test_resp_status_shape_is_read(self):
        # googleapiclient.HttpError carries ``resp.status``.
        _, scope = self._capture(_FakeHttpError(500))

        scope.set_tag.assert_called_once_with(
            'error_code', 'provider_error'
        )

    def test_response_status_code_shape_is_read(self):
        # requests/pywebpush exceptions carry ``response.status_code``.
        _, scope = self._capture(_FakeResponseError(429))

        scope.set_tag.assert_called_once_with(
            'error_code', 'rate_limited'
        )

    def test_status_code_attr_shape_is_read(self):
        # GoCardlessError carries a plain ``status_code``.
        class E(Exception):
            status_code = 429

        _, scope = self._capture(E('api error'))

        scope.set_tag.assert_called_once_with(
            'error_code', 'rate_limited'
        )

    def test_disallowed_error_code_is_never_sent(self):
        sdk, _ = self._capture(
            RuntimeError('boom'), error_code='not_found'
        )

        sdk.capture_exception.assert_not_called()

    def test_extra_tags_are_set_on_the_scope(self):
        _, scope = self._capture(
            RuntimeError('boom'), tags={'app': 'finance'}
        )

        scope.set_tag.assert_any_call('error_code', 'provider_error')
        scope.set_tag.assert_any_call('app', 'finance')


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
