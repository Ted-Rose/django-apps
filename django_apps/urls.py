from functools import partial

from django.contrib import admin
from django.urls import include, path
from django.conf import settings
from django.conf.urls.static import static
from . import views
from django_apps.api import api
from django_apps.me import router as me_router
from django_apps.views import react_app
from gmail.api import router as gmail_router
from google_tasks.api import router as tasks_router
from google_tasks.notes_api import router as notes_router
from finance.api import router as finance_router
from single_pages.api import router as sp_router

app_name = 'main'

api.add_router('/me/', me_router)
api.add_router('/gmail/', gmail_router)
api.add_router('/tasks/', tasks_router)
api.add_router('/notes/', notes_router)
api.add_router('/finance/', finance_router)
api.add_router('/single_pages/', sp_router)

# The notes SPA is data-owned by google_tasks (notes are GoogleTask
# rows) but mounts at a top-level /notes/ prefix — like tasks, every
# GET/HEAD serves the shell and React Router resolves the page.
react_app_notes = partial(react_app, entry='notes', title='Notes')

urlpatterns = [
    path('admin/', admin.site.urls),
    # django-ninja JSON API (session auth + CSRF; React SPA contract)
    path('api/', api.urls),
    # PWA endpoints (served at the site root so the SW scope is the whole site)
    path('sw.js', views.service_worker, name='service_worker'),
    path('manifest.webmanifest', views.manifest, name='manifest'),
    path('offline/', views.offline, name='offline'),
    path('', include('google_api.urls', namespace='google_api')),
    path('', include('gmail.urls', namespace='gmail')),
    path('tasks/', include('google_tasks.urls', namespace='google_tasks')),
    path('finance/', include('finance.urls', namespace='finance')),
    path('notes/', react_app_notes, name='notes'),
    path('notes/<path:subpath>', react_app_notes,
         name='notes_subpath'),
    path('', include('single_pages.urls', namespace='single_pages')),
    path('', views.home),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

if settings.DEBUG:
    # Chrome DevTools probes this on every page load while open.
    urlpatterns.append(path(
        '.well-known/appspecific/com.chrome.devtools.json',
        views.chrome_devtools_probe,
    ))
