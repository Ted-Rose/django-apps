from django.urls import path
from google_tasks import views

app_name = 'google_tasks'

# Stage 6 cutover: the React SPA is the only UI under /tasks/. Every
# GET/HEAD path renders the shell and React Router resolves the page;
# non-GET requests to the retired mutation URLs (sync/,
# task/<id>/complete/, ...) 404 in react_app — mutations live under
# /api/tasks/ now.
urlpatterns = [
    # 'dashboard' keeps reverse('google_tasks:dashboard') working —
    # home.html links to it and google_api's OAuth callback uses it as
    # the default oauth_redirect_url.
    path('', views.react_app, name='dashboard'),
    # Legacy strangler mount (Stages 1–5): 301 to the real routes so
    # bookmarks/links like /tasks/app/starred/ keep working. The
    # bare 'app' pattern (no trailing slash) keeps /tasks/app from
    # falling through to the catch-all below.
    path('app', views.app_redirect, name='react_app_noslash'),
    path('app/', views.app_redirect, name='react_app'),
    path(
        'app/<path:subpath>',
        views.app_redirect,
        name='react_app_subpath'
    ),
    # No trailing slash on <path:subpath> — it matches both
    # 'x' and 'x/', so client-side routes don't depend on
    # an APPEND_SLASH redirect hop.
    path('<path:subpath>', views.react_app, name='spa_subpath'),
]
