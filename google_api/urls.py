from django.urls import path
from . import views
from google_api.utils import callback

app_name = 'google_api'

urlpatterns = [
    path('login/', views.login_view, name='login'),
    path('google/callback', callback, name='callback'),
    # Shared JSON endpoint — twister.html fetches it until the
    # single_pages rewrite removes the last caller.
    path('text-to-audio', views.audio, name='audio'),
]
