from functools import partial

from django.urls import path

from django_apps.views import app_redirect, react_app

app_name = 'gmail'

# Stage 5 cutover: the React SPA is the only UI under /gmail/.
react_app_gmail = partial(
    react_app, entry='gmail', title='Gmail to Audio'
)
app_redirect_gmail = partial(app_redirect, base='gmail')

urlpatterns = [
    # Legacy page URL → canonical SPA mount; app_redirect keeps the
    # query string, so ?get_messages&query=… bookmarks land on
    # /gmail/?get_messages&query=… and the SPA auto-fetches.
    path('gmail-to-audio', app_redirect_gmail, name='legacy'),
    # 'index' name moved here — home.html reverses gmail:index and
    # lands on the SPA. gmail-mark-read's route is gone outright:
    # POSTs to it hit no route → 404 (the view stays, unrouted —
    # the /api/gmail/mark-read/ op delegates to it).
    path('gmail/', react_app_gmail, name='index'),
    path('gmail/<path:subpath>', react_app_gmail,
         name='spa_subpath'),
]
