from django.urls import path
from . import views
from google_api.utils import callback

app_name = 'google_api'

urlpatterns = [
    path('login/', views.login_view, name='login'),
    path('google/callback', callback, name='callback'),
    # Legacy public JSON endpoint — DISABLED (security finding F3):
    # it was unauthenticated, so anyone could burn gTTS + GCS
    # operations. No in-repo callers remain (SPAs use the
    # session-authed /api/gmail/audio/ + /api/single_pages/tts/
    # ops). The view code stays in views.py; uncomment to restore.
    # path('text-to-audio', views.audio, name='audio'),
]
