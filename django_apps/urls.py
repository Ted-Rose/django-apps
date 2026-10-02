from django.contrib import admin
from django.urls import include, path
from django.conf import settings
from django.conf.urls.static import static
from . import views
from django_apps.api import api
from django_apps.me import router as me_router
from google_tasks.api import router as tasks_router
from finance.api import router as finance_router

app_name = 'main'

api.add_router('/me/', me_router)
api.add_router('/tasks/', tasks_router)
api.add_router('/finance/', finance_router)

urlpatterns = [
    path('admin/', admin.site.urls),
    # django-ninja JSON API (session auth + CSRF; React SPA contract)
    path('api/', api.urls),
    # PWA endpoints (served at the site root so the SW scope is the whole site)
    path('sw.js', views.service_worker, name='service_worker'),
    path('manifest.webmanifest', views.manifest, name='manifest'),
    path('offline/', views.offline, name='offline'),
    path('', include('google_api.urls', namespace='google_api')),
    path('tasks/', include('google_tasks.urls', namespace='google_tasks')),
    path('finance/', include('finance.urls', namespace='finance')),
    path('', include('single_pages.urls', namespace='single_pages')),
    path('', views.home),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

if settings.DEBUG:
    # Chrome DevTools probes this on every page load while open.
    urlpatterns.append(path(
        '.well-known/appspecific/com.chrome.devtools.json',
        views.chrome_devtools_probe,
    ))
