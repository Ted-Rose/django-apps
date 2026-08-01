from django.conf import settings
from django.shortcuts import render
from django.views.decorators.cache import cache_control


def home(request):
    return render(request, 'home.html')


# --- Progressive Web App (PWA) endpoints ---

# Bump this to force clients to refresh the service worker cache.
PWA_CACHE_VERSION = '1'


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
    """Serve the service worker from the root so its scope is the whole site."""
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
