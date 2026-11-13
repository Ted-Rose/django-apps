import json
import os
import re

from django.conf import settings
from django.http import Http404, JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.cache import cache_control


# --- Progressive Web App (PWA) endpoints ---

# Bump this to force clients to refresh the service worker cache.
PWA_CACHE_VERSION = '27'


def manifest(request):
    """Serve the web app manifest at the site root scope."""
    response = render(
        request, 'pwa/manifest.webmanifest',
        content_type='application/manifest+json',
    )
    # s-maxage lets Vercel's shared edge cache hold the anonymous
    # response (plain max-age is browser-only); content is identical
    # for every user.
    response['Cache-Control'] = 'public, max-age=86400, s-maxage=86400'
    return response


@cache_control(no_cache=True)
def service_worker(request):
    """Serve the worker from the root so its scope is the whole site."""
    context = {
        'cache_version': PWA_CACHE_VERSION,
        'offline_url': '/offline/',
        'static_url': settings.STATIC_URL,
    }
    response = render(
        request, 'pwa/sw.js', context,
        content_type='application/javascript',
    )
    # Allow the worker (even if served from a sub-path) to control the root.
    response['Service-Worker-Allowed'] = '/'
    return response


def offline(request):
    """Fallback page shown by the service worker when the user is
    offline. Static, anonymous content — edge-cacheable like the
    manifest."""
    response = render(request, 'pwa/offline.html')
    response['Cache-Control'] = 'public, max-age=86400, s-maxage=86400'
    return response


def chrome_devtools_probe(request):
    """Chrome DevTools GETs this while open to detect workspace
    integration — an empty object keeps the 404 WARNING noise out of
    the runserver log. Routed only when DEBUG."""
    return JsonResponse({})


# The one Vite entry every app mount serves — the unified shell
# (frontend/src/shell/main.tsx) owns all client-side routes.
SHELL_ENTRY = 'shell'

# SPA entry names map to keys in manifest.json — restrict them to
# plain lowercase identifiers so a caller-supplied `entry` can't
# traverse or 500 on {% vite_asset %}.
SPA_ENTRY_RE = re.compile(r'[a-z0-9_]+')


def _manifest_has_entry(manifest_path, entry_key):
    """True only if manifest.json exists AND still lists `entry_key`.

    A stale/partial build can leave a manifest that lacks the entry —
    {% vite_asset %} would raise DjangoViteAssetNotFoundError (500)
    on it, so the caller degrades to the diagnostic warning instead.
    A corrupt manifest degrades the same way.
    """
    try:
        with open(manifest_path, 'r') as manifest_file:
            return entry_key in json.load(manifest_file)
    except (OSError, ValueError):
        return False


def spa_shell(request, entry=SHELL_ENTRY, title=''):
    """Render the shared React SPA shell — public + edge-cacheable.

    Every app mount serves the SAME shell (`src/shell/main.tsx`):
    the response must be byte-identical for all users, so no
    `@login_required`, no `@ensure_csrf_cookie`, no per-user
    context, and no cookies — `s-maxage` lets Vercel's shared edge
    cache hold it while `max-age=0` keeps browsers revalidating.
    Per-user context (username/language/is_staff) arrives via the
    `GET /api/me/` bootstrap call the shell fires at startup, which
    also plants the csrftoken cookie. Anonymous users get the same
    HTML; the client navigates to login after the bootstrap 401.

    `manifest_ready` tells the template whether {% vite_asset %} is
    safe to call: always in dev mode (VITE_DEV=1, where django-vite
    hits the dev server and never reads the manifest), or in prod
    only when manifest.json exists and contains the entry key.
    Otherwise the page shows a diagnostic instead of crashing.
    """
    if not SPA_ENTRY_RE.fullmatch(entry):
        raise Http404(f'Unknown SPA entry: {entry}')
    vite_entry = f'src/{entry}/main.tsx'
    vite_config = settings.DJANGO_VITE.get('default', {})
    manifest_path = vite_config.get(
        'manifest_path',
        os.path.join(settings.BASE_DIR, 'frontend_dist',
                     'manifest.json'),
    )
    response = render(request, 'spa_shell.html', {
        'title': title,
        'vite_entry': vite_entry,
        'manifest_ready': (
            vite_config.get('dev_mode')
            or _manifest_has_entry(manifest_path, vite_entry)
        ),
        'bootstrap': {
            # The web SDK reads this straight from the rendered
            # #spa-bootstrap json_script before React mounts — no
            # build-time VITE_* plumbing. None DSN → no init. It is
            # deployment config, identical for every user — nothing
            # per-user may join it or the page stops being
            # edge-cacheable.
            'sentry': {
                'dsn': settings.SENTRY_WEB_DSN,
                'environment': settings.SENTRY_ENVIRONMENT,
                'release': settings.SENTRY_RELEASE,
            },
        },
    })
    response['Cache-Control'] = 'public, max-age=0, s-maxage=86400'
    return response


def react_app(request, title='', subpath=''):
    """React SPA shell shared by every app-level mount (and /).

    Mount with functools.partial (or a thin wrapper) binding
    `title`, e.g.::

        path('', partial(react_app, title='Tasks'))
        path('notes/<path:subpath>',
             partial(react_app, title='Notes'))

    Every GET/HEAD path under the mount renders the unified shell
    and React Router resolves the page client-side; `subpath` is
    captured by <path:subpath> catch-alls and intentionally unused.

    Non-GET/HEAD requests 404: retired template-mutation URLs must
    not answer with the HTML shell — mutations live under /api/.
    """
    if request.method not in ('GET', 'HEAD'):
        raise Http404
    return spa_shell(request, title=title)


def app_redirect(request, base, subpath=''):
    """301 /<base>/app/<subpath> → /<base>/<subpath>.

    Used for the strangler-mount cleanup: while an SPA is staged at
    /<base>/app/ the mount serves `react_app`; after cutover the app
    paths 301 here so old links/bookmarks keep working without
    serving the shell twice. `base` tolerates missing slashes
    ('tasks' and '/tasks/' behave the same). Deliberately NOT
    login_required: anonymous users are bounced to login by the
    destination page after the redirect, avoiding a double hop.
    """
    prefix = f"/{base.strip('/')}/" if base.strip('/') else '/'
    target = f'{prefix}{subpath}'
    if request.GET:
        target = f'{target}?{request.GET.urlencode()}'
    return redirect(target, permanent=True)
