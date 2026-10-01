from functools import partial

from django.urls import path

from django_apps.views import app_redirect, react_app
from finance import views

app_name = 'finance'

# Stage 6 cutover: the React SPA is the only UI under /finance/.
# Every GET/HEAD path renders the shell and React Router resolves
# the page; non-GET requests to the retired form-POST URLs
# (rules/save/, transactions/sync/, push/subscribe/, ...) 404 in
# react_app — mutations live under /api/finance/ now. Both helpers
# are shared (django_apps.views); `entry` picks the Vite bundle.
react_app_finance = partial(
    react_app, entry='finance', title='Finance'
)
app_redirect_finance = partial(app_redirect, base='/finance/')

urlpatterns = [
    # External redirect target baked into GoCardless requisitions
    # ({BASE_URL}/finance/callback/) — stays a Django view forever
    # and must precede the catch-all below.
    path('callback/', views.requisition_callback, name='callback'),
    # Every page name keeps resolving for reverse() callers
    # (home.html's finance:accounts, evaluate_spending_limits'
    # finance:limits, the callback's finance:connect/accounts
    # redirects); each serves the SPA shell and React Router
    # resolves the page client-side.
    path('', react_app_finance, name='index'),
    path('connect/', react_app_finance, name='connect'),
    path('accounts/', react_app_finance, name='accounts'),
    path('transactions/', react_app_finance, name='transactions'),
    path('balances/', react_app_finance, name='balances'),
    path('limits/', react_app_finance, name='limits'),
    path('rules/', react_app_finance, name='rules'),
    path('categories/', react_app_finance, name='categories'),
    # Legacy strangler mount (Stages 1–5): 301 to the real routes so
    # bookmarks/links like /finance/app/rules keep working. The
    # bare 'app' pattern (no trailing slash) keeps /finance/app from
    # falling through to the catch-all below.
    path('app', app_redirect_finance, name='react_app_noslash'),
    path('app/', app_redirect_finance, name='react_app'),
    path(
        'app/<path:subpath>',
        app_redirect_finance,
        name='react_app_subpath',
    ),
    # No trailing slash on <path:subpath> — it matches both
    # 'x' and 'x/', so client-side routes don't depend on
    # an APPEND_SLASH redirect hop.
    path('<path:subpath>', react_app_finance, name='spa_subpath'),
]
