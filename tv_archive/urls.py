from functools import partial

from django.urls import path

from django_apps.views import app_redirect, react_app_public

app_name = 'tv_archive'

# Stage 3 cutover: the React SPA is the only UI under /tv-arhivs.
# Every GET/HEAD path renders the shell and React Router resolves
# the page; non-GET requests 404 in _react_app (vacuous here — the
# app never had mutation URLs). react_app_public (not react_app) —
# the page is public today and stays public; the API behind it is
# GET-only so no CSRF cookie is needed.
react_app_tv = partial(
    react_app_public, entry='tv_archive', title='TV Archive'
)
app_redirect_tv = partial(app_redirect, base='/tv-arhivs/')

urlpatterns = [
    # 'tv-arhivs' keeps reverse('tv_archive:tv-arhivs') working —
    # home.html links to it.
    path('tv-arhivs', react_app_tv, name='tv-arhivs'),
    path('tv-arhivs/', react_app_tv),
    # Legacy strangler mount (Stages 1–2): 301 to the real routes so
    # bookmarks/links like /tv-arhivs/app/ keep working.
    path('tv-arhivs/app', app_redirect_tv),
    path('tv-arhivs/app/', app_redirect_tv),
    path('tv-arhivs/app/<path:subpath>', app_redirect_tv),
    # catch-all LAST — it would otherwise swallow tv-arhivs/app*
    path('tv-arhivs/<path:subpath>', react_app_tv,
         name='spa_subpath'),
]
