"""Shared django-ninja API layer (Stage 0 of the React rewrite).

One NinjaAPI mounted at /api/ — apps register routers on it in
django_apps/urls.py (e.g. api.add_router('/tasks/', tasks_router) →
/api/tasks/...). Auth is ninja's django_auth (session cookie, CSRF
enforced on unsafe methods) with JSON 401s instead of redirects,
plus the google_reauth contract the SPA uses to bounce users into
the OAuth flow (fetch must never follow Google redirects).
"""
from django.http import Http404
from ninja import NinjaAPI
from ninja.errors import AuthenticationError, HttpError
from ninja.security import django_auth

api = NinjaAPI(
    title='django-apps API',
    version='0.1.0',
    auth=django_auth,
)


class GoogleReauthRequired(Exception):
    """Raised when Google credentials are missing or dead — becomes
    a 401 so the SPA can navigate to the OAuth flow itself."""

    def __init__(self, authorization_url):
        self.authorization_url = authorization_url
        super().__init__(authorization_url)


_ERROR_SLUGS = {
    400: 'bad_request',
    401: 'unauthenticated',
    403: 'forbidden',
    404: 'not_found',
    405: 'method_not_allowed',
    409: 'conflict',
    429: 'throttled',
    500: 'server_error',
}


def error_slug(status_code):
    """Stable machine-readable slug for the uniform error shape."""
    return _ERROR_SLUGS.get(status_code, 'error')


@api.exception_handler(AuthenticationError)
def _on_unauthenticated(request, exc):
    """Session auth failed → JSON 401, never a login redirect."""
    return api.create_response(request, {
        'error': 'unauthenticated',
        'login_url': f'/admin/login/?next={request.get_full_path()}',
    }, status=401)


@api.exception_handler(GoogleReauthRequired)
def _on_google_reauth(request, exc):
    return api.create_response(request, {
        'error': 'google_reauth',
        'authorization_url': exc.authorization_url,
    }, status=401)


@api.exception_handler(Http404)
def _on_not_found(request, exc):
    return api.create_response(request, {
        'error': 'not_found',
        'detail': str(exc) or 'Not Found',
    }, status=404)


@api.exception_handler(HttpError)
def _on_http_error(request, exc):
    return api.create_response(request, {
        'error': error_slug(exc.status_code),
        'detail': str(exc),
    }, status=exc.status_code)
