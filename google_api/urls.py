from django.urls import path
from . import views
from google_api.utils import callback

app_name = 'google_api'

urlpatterns = [
    path('login/', views.login_view, name='login'),
    path('google/callback', callback, name='callback'),
    # Legacy public JSON endpoint — the single_pages rewrite removed
    # its last in-repo caller (twister.html); SPAs use the
    # session-authed /api/gmail/audio/ + /api/single_pages/tts/ ops.
    # Kept routed until a deliberate gate-or-delete decision.
    path('text-to-audio', views.audio, name='audio'),
]
