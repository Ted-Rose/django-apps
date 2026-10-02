from functools import partial

from django.urls import path

from django_apps.views import app_redirect, react_app

app_name = 'single_pages'

# Cutover: the React SPA (frontend/src/single_pages/, Vite entry
# 'single_pages') owns both page paths. This app mounts at ROOT —
# Django decides which URLs serve the shell, so there is no
# <path:subpath> catch-all here (a root catch-all would shadow
# every later include + home). Deep links under the page paths
# (/twister/foo, /spoki/x/) 404 — intentional, no client-side
# sub-routes exist.
react_app_sp = partial(
    react_app, entry='single_pages', title='Pages'
)
app_redirect_root = partial(app_redirect, base='')

urlpatterns = [
    # Both names kept — home.html reverses 'single_pages:twister'.
    path('twister', react_app_sp, name='twister'),
    path('spoki/', react_app_sp, name='spoki_page'),
    # Legacy strangler mount (/app/*) → 301 to the real paths;
    # base='' routes at site root (app_redirect tolerates it).
    path('app', app_redirect_root, name='react_app_noslash'),
    path('app/', app_redirect_root, name='react_app'),
    path('app/<path:subpath>', app_redirect_root,
         name='react_app_subpath'),
]
