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


def capture_internal_exception(exc):
    """Send a genuine server-side failure to Sentry, when enabled.

    ``DjangoIntegration`` only reports *uncaught* exceptions, so
    a bug caught by an API catch-all or a job runner stays
    invisible unless reported explicitly. Captured at ``error``
    level under the ``error_code:internal_error`` tag — the same
    slug the 500 catch-all returns. No-ops when sentry-sdk is not
    installed or no ``SENTRY_DSN`` was configured at startup (the
    SDK is then uninitialized and ``capture_exception`` does
    nothing). The exception object is passed, never a formatted
    string — ``str(exc)`` can embed credential-bearing URLs.
    """
    try:
        import sentry_sdk
    except ImportError:
        return
    with sentry_sdk.new_scope() as scope:
        scope.set_tag('error_code', 'internal_error')
        sentry_sdk.capture_exception(exc, level='error')
