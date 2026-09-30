import os

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from django.views.decorators.cache import cache_control
from django.views.decorators.csrf import ensure_csrf_cookie


def home(request):
    return render(request, 'home.html')


# --- Progressive Web App (PWA) endpoints ---

# Bump this to force clients to refresh the service worker cache.
PWA_CACHE_VERSION = '4'


def manifest(request):
    """Serve the web app manifest at the site root scope."""
    response = render(
        request, 'pwa/manifest.webmanifest',
        content_type='application/manifest+json',
    )
    response['Cache-Control'] = 'public, max-age=86400'
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
    """Fallback page shown by the service worker when the user is offline."""
    return render(request, 'pwa/offline.html')


@login_required
@ensure_csrf_cookie
def spa_shell(request, entry, title=''):
    """Render the shared React SPA shell for a Vite entry name.

    `entry` is the app folder under frontend/src/ (e.g. 'tasks' →
    src/tasks/main.tsx). `manifest_ready` tells the template whether
    frontend_dist/ is present in this runtime — on hosts where the
    build output isn't bundled (the Vercel spike question) the page
    shows a diagnostic instead of crashing in {% vite_asset %}.
    """
    manifest_path = settings.DJANGO_VITE.get('default', {}).get(
        'manifest_path',
        os.path.join(settings.BASE_DIR, 'frontend_dist',
                     'manifest.json'),
    )
    return render(request, 'spa_shell.html', {
        'title': title,
        'vite_entry': f'src/{entry}/main.tsx',
        'manifest_ready': os.path.exists(manifest_path),
        'bootstrap': {'user': request.user.get_username()},
    })
