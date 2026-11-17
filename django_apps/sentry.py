"""Sentry helpers for the ``django_apps`` project package.

DSN-gated: when ``SENTRY_DSN`` is unset the SDK never initializes
and every capture call here is a no-op.
"""
from urllib.parse import urlparse

# Paths whose request bodies carry credentials — the only real
# password POST is /admin/login/ (Django admin); /login/ is just
# a GET redirect into Google OAuth but stays scrubbed as defense
# in depth. ``sentry_before_send`` strips the parsed body for
# these paths so secrets can never reach Sentry.
_SENSITIVE_PATH_PREFIXES = (
    '/login/',
    '/admin/',
)

# The OAuth redirect_uri — its query string carries the single-use
# authorization ``code`` (a credential), so events drop it.
_OAUTH_CALLBACK_PATH = '/google/callback'


def sentry_before_send(event, hint):
    """Scrub sensitive request data before a Sentry event sends.

    Drops the parsed request body (``request.data``) on credential
    paths — those bodies contain passwords/OAuth secrets — and the
    query string on the OAuth callback, whose ``code`` param is a
    credential. Defense in depth on top of
    ``send_default_pii=False`` and the org-level data scrubbers.
    URL, method, and headers are kept so the event stays
    debuggable.
    """
    request = event.get('request')
    if not isinstance(request, dict):
        return event
    parsed = urlparse(request.get('url') or '')
    if parsed.path.startswith(_SENSITIVE_PATH_PREFIXES):
        request.pop('data', None)
    if parsed.path == _OAUTH_CALLBACK_PATH:
        request['url'] = parsed._replace(
            query='', fragment=''
        ).geturl()
    return event


def _sentry_capture(exc, error_code, level, tags=None):
    """Send *exc* to Sentry tagged ``error_code`` at *level*.

    No-ops when sentry-sdk is not installed or no ``SENTRY_DSN``
    was configured at startup (the SDK is then uninitialized and
    ``capture_exception`` does nothing). The exception object is
    passed, never a formatted string — ``str(exc)`` can embed
    credential-bearing URLs. ``tags`` carries extra filtering
    dimensions (``app``/``job``/``operation`` names) so the
    ``is:unresolved level:error`` queue stays attributable.
    """
    try:
        import sentry_sdk
    except ImportError:
        return
    with sentry_sdk.new_scope() as scope:
        scope.set_tag('error_code', error_code)
        for key, value in (tags or {}).items():
            scope.set_tag(key, str(value))
        sentry_sdk.capture_exception(exc, level=level)


def capture_internal_exception(exc, tags=None):
    """Send a genuine server-side failure to Sentry, when enabled.

    ``DjangoIntegration`` only reports *uncaught* exceptions, so
    a bug caught by an API catch-all or a job runner stays
    invisible unless reported explicitly. Captured at ``error``
    level under the ``error_code:internal_error`` tag — the same
    slug the 500 catch-all returns. ``tags`` optionally adds
    attribution (``job``/``operation`` names). DSN-gated — see
    ``_sentry_capture``.
    """
    _sentry_capture(exc, 'internal_error', 'error', tags)


def _upstream_status_code(exc):
    """HTTP status an upstream provider returned, if it carries one.

    Covers the shapes this repo's provider clients expose:
    ``GoCardlessError.status_code``, googleapiclient
    ``HttpError.resp.status`` and requests/pywebpush
    ``exc.response.status_code``. ``None`` when the exception
    carries no status (network timeouts, local bugs).
    """
    status = getattr(exc, 'status_code', None)
    if isinstance(status, int):
        return status
    resp = getattr(exc, 'resp', None)
    status = getattr(resp, 'status', None)
    if isinstance(status, int):
        return status
    response = getattr(exc, 'response', None)
    status = getattr(response, 'status_code', None)
    if isinstance(status, int):
        return status
    return None


# Only upstream outages are worth trending in Sentry; codes for
# routine handled outcomes are deliberately excluded.
_PROVIDER_CAPTURED_CODES = frozenset({'rate_limited', 'provider_error'})


def capture_provider_exception(exc, error_code=None, tags=None):
    """Send an expected upstream failure to Sentry, when enabled.

    Caught Google/GoCardless/push-service failures are handled
    where they land (logged, degraded, retried), so they never
    reach ``DjangoIntegration`` — this captures them at
    ``warning`` level for trending, tagged ``error_code``
    (``rate_limited`` when the upstream status is 429, else
    ``provider_error``). An explicit *error_code* outside
    ``_PROVIDER_CAPTURED_CODES`` is dropped — routine handled
    outcomes must never reach Sentry, and real bugs belong to
    ``capture_internal_exception`` at ``error`` level.
    """
    if error_code is None:
        status = _upstream_status_code(exc)
        error_code = (
            'rate_limited' if status == 429 else 'provider_error'
        )
    if error_code not in _PROVIDER_CAPTURED_CODES:
        return
    _sentry_capture(exc, error_code, 'warning', tags)
