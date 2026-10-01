from functools import partial

from django.urls import path

from django_apps.views import react_app_public
from . import views

app_name = 'tv_archive'

# Strangler staging mount (Stage 1 of the React rewrite): the SPA
# lives at /tv-arhivs/app/ while the template keeps serving
# /tv-arhivs; the cutover stage swaps them and 301s app/* → /*.
# react_app_public (not react_app) — the page is public today and
# stays public; the API behind it is GET-only so no CSRF cookie is
# needed.
react_app_tv = partial(
    react_app_public, entry='tv_archive', title='TV Archive'
)

urlpatterns = [
    path('tv-arhivs/app', react_app_tv, name='spa_app'),
    path('tv-arhivs/app/', react_app_tv),
    path('tv-arhivs/app/<path:subpath>', react_app_tv),
    path('tv-arhivs', views.content_list, name='tv-arhivs'),
]
