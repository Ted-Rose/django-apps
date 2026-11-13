# Tasks

## 1. Low-risk flags and hygiene (F2, F5, F6, F10, F12)

- [ ] 1.1 backend: F2 — validate `next`/`oauth_redirect_url` in
  `google_api/views.py::login_view` and
  `google_api/utils.py::callback` via
  `url_has_allowed_host_and_scheme` + view-name fallback
  (`google_tasks:dashboard`).
- [ ] 1.2 backend: F5 — set `SESSION_COOKIE_SECURE`,
  `CSRF_COOKIE_SECURE`, `SECURE_SSL_REDIRECT`,
  `SECURE_HSTS_SECONDS = 3600` in `settings.py`'s
  `IS_CLOUD_ENVIRONMENT` branch only.
- [ ] 1.3 backend: F6 — gate
  `os.environ.setdefault('OAUTHLIB_INSECURE_TRANSPORT', '1')`
  on `settings.BASE_URL.startswith('http://')` in
  `google_api/utils.py`.
- [ ] 1.4 backend: F10 — delete the
  `request.session['google_credentials']` write in `callback`.
- [ ] 1.5 backend: F12 — replace `{'error': str(e)}` with
  fixed messages + `logger.exception` at the
  `google_tasks/views.py` sites; delete the dead
  `google_api/views.py::audio` handler.
- [ ] 1.6 backend: Tests — external `next` is ignored (authed
  and post-callback); view-name `next` still resolves; a
  session-cred-free `callback`; one `str(e)` site now returns
  the fixed message.

## 2. OAuth state validation (F1)

- [ ] 2.1 backend: In `callback`, compare
  `request.GET.get('state')` to `request.session.pop('state',
  None)` before `fetch_token`; mismatch/missing → warn-log +
  redirect to login.
- [ ] 2.2 backend: Tests — forged/absent state aborts before
  `fetch_token` (assert `fetch_token` not called); matching
  state proceeds; a session-less hit fails closed.

## 3. Host scoping (F11) — last

- [ ] 3.1 backend: Replace wildcard hosts in
  `settings.py::ALLOWED_HOSTS` with
  `tedisrozenfelds.vercel.app`, the exact Cloud Run
  `*.run.app` hostname, and the existing
  localhost/pythonanywhere entries — copy the Cloud Run
  hostname verbatim from `gcloud run services describe`.
- [ ] 3.2 backend: Sanity — `manage.py check`; confirm nothing
  else (health checks, scheduler OIDC Host headers) depends on
  a wildcard.

## 4. Gates and docs

- [ ] 4.1 backend: `python manage.py test google_api` +
  `python manage.py test google_tasks` green;
  `awk 'length > 79'` clean on touched files.
- [ ] 4.2 both: Update `google_api/AGENTS.md` (state check +
  no session creds), root `AGENTS.md` if the Gotchas/OAuth
  notes change, and mark the findings `fixed` in
  `docs/research/security-audit.md`; changelog entry for the
  user-visible login-flow change.
