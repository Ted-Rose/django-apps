# Design

Source: `docs/research/security-audit.md` (moved from
`docs/plans/SECURITY_AUDIT_FIXES.md`), verified against current
code on `main` (2ca5ce1). Already-resolved findings (F3, F4, F7,
F8, F9) are out of scope; F13 is an accepted risk.

## F1 — OAuth `state` validation (High)

`google_api/utils.py::callback` builds a fresh
`InstalledAppFlow` and calls `fetch_token` directly — no
`authorization_url()` call, so oauthlib's `_state` is `None` and
validation is skipped entirely. Fix: compare
`request.GET.get('state')` to `request.session.pop('state',
None)` at the top of `callback`; mismatch/missing → log +
redirect to login before `fetch_token`.

Watch-outs (from the audit, still true): the single
`session['state']` slot is written by several flows — parallel
tabs make the older flow fail closed; session-less callback hits
( cookie blocked/expired) currently succeed and will now
hard-fail. Both are the correct fail-closed behavior.

## F2 — `next` open redirect (Medium)

`login_view` stores `request.GET['next']` verbatim and
`callback` redirects to `session['oauth_redirect_url']`. Fix:
validate with `url_has_allowed_host_and_scheme(
next_url, allowed_hosts={request.get_host()})`; when it fails,
try resolving the value as a view name (sync/complete flows
store `'google_tasks:dashboard'`, not a URL); else fall back to
the dashboard. Verify with the real `.run.app` hostname —
`get_host()` rides the Host/`SECURE_PROXY_SSL_HEADER` chain.

## F5 — Secure transport flags (Medium)

Set `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`,
`SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS = 3600` (small
max-age first, no `includeSubDomains`) inside the
`IS_CLOUD_ENVIRONMENT` branch only — unconditional flags would
kill `http://127.0.0.1` dev sessions. `SECURE_SSL_REDIRECT` is
safe because `SECURE_PROXY_SSL_HEADER` is already set; confirm
nothing internal hits the service over plain HTTP (scheduler →
job calls are HTTPS already).

## F6 — `OAUTHLIB_INSECURE_TRANSPORT` gating (Low)

Gate the `setdefault` on `settings.BASE_URL.startswith(
'http://')` — NOT on `DEBUG` (the config.yaml fallback can run
`DEBUG=False` locally). Keep `OAUTHLIB_RELAX_TOKEN_SCOPE`
unconditional — incremental scopes need it everywhere.

## F10 — Session credential duplication (Low)

Delete the `request.session['google_credentials'] = {…}` write
in `callback`. Verified safe in the audit: the key is written
but never read by code (only docs mention it).

## F11 — `ALLOWED_HOSTS` wildcards (Low)

Replace `.vercel.app`/`.appspot.com`/`.run.app` with the exact
hostnames: `tedisrozenfelds.vercel.app`, the Cloud Run
`*.run.app` service URL, plus the existing pythonanywhere/
localhost entries. The Cloud Run hostname must be copied
verbatim — dropping it 400s the whole site. `.appspot.com` is
vestigial (no App Engine deploy remains).

## F12 — `str(e)` leakage (Low)

`google_tasks/views.py` returns `{'error': str(e)}` from several
JSON handlers; `_adapt` then surfaces it as `detail`. Fix at the
views: return fixed messages (`'Sync failed'` etc.) and log the
exception; `_adapt` needs no contract change. Also delete the
dead `views.audio` handler in `google_api/views.py` (route
commented out) — it carries two `str(e)` bodies.

## Ordering

Audit's suggested order still holds: F2, F5, F6, F10, F12 first
(low risk), then F1 (test the parallel-tab retry), F11 last
(hostname copy is the risky bit). One PR is fine — the findings
are independent.

## Explicitly out of scope

- F13 field-level encryption of OAuth tokens — accepted risk.
- Rate limiting on remaining public endpoints.
- Any frontend changes — all findings are backend/settings.
