from functools import partial

from django.urls import path
from django_apps.views import app_redirect, react_app

app_name = 'google_tasks'

# Stage 6 cutover: the React SPA is the only UI under /tasks/. Every
# GET/HEAD path renders the shell and React Router resolves the page;
# non-GET requests to the retired mutation URLs (sync/,
# task/<id>/complete/, ...) 404 in react_app — mutations live under
# /api/tasks/ now. Both helpers are shared (django_apps.views, since
# finance Stage 1); `entry` picks the Vite bundle.
react_app_tasks = partial(react_app, entry='tasks', title='Tasks')
app_redirect_tasks = partial(app_redirect, base='/tasks/')

urlpatterns = [
    # 'dashboard' keeps reverse('google_tasks:dashboard') working —
    # home.html links to it and google_api's OAuth callback uses it as
    # the default oauth_redirect_url.
    path('', react_app_tasks, name='dashboard'),
    # Legacy strangler mount (Stages 1–5): 301 to the real routes so
    # bookmarks/links like /tasks/app/starred/ keep working. The
    # bare 'app' pattern (no trailing slash) keeps /tasks/app from
    # falling through to the catch-all below.
    path('app', app_redirect_tasks, name='react_app_noslash'),
    path('app/', app_redirect_tasks, name='react_app'),
    path(
        'app/<path:subpath>',
        app_redirect_tasks,
        name='react_app_subpath'
    ),
    # No trailing slash on <path:subpath> — it matches both
    # 'x' and 'x/', so client-side routes don't depend on
    # an APPEND_SLASH redirect hop.
    path('<path:subpath>', react_app_tasks, name='spa_subpath'),
]
