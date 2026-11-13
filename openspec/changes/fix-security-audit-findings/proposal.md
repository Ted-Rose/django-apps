# Proposal

## Why

A whole-codebase security audit (now at
`docs/research/security-audit.md`) found 13 findings. Several
were fixed or resolved by app removal — F3 (`/text-to-audio`
route disabled; its replacement API ops are session-authed),
F4 (spoki HTML now `nh3.clean`-sanitized), F7/F8/F9 (the
vulnerable code was deleted with the SPA cutover / app
removals). The remaining findings are still open in today's
code and form one hardening batch:

- **F1 (High)** — `google_api/utils.py::callback` never compares
  Google's returned `state` to `request.session['state']`:
  classic login CSRF — an attacker can log a victim in as the
  attacker's account.
- **F2 (Medium)** — `?next=` is stored in the session and
  redirected to unvalidated (`login_view`, `callback`) — an
  open-redirect/phishing primitive.
- **F5 (Medium)** — `SESSION_COOKIE_SECURE`,
  `CSRF_COOKIE_SECURE`, `SECURE_SSL_REDIRECT` and HSTS are never
  set; production cookies lack `Secure`.
- **F6 (Low)** — `OAUTHLIB_INSECURE_TRANSPORT=1` is set
  unconditionally at `google_api/utils.py` import, disabling
  oauthlib's HTTPS enforcement in production too.
- **F10 (Low)** — the refresh token is duplicated into the
  session store (`session['google_credentials']`, written but
  never read).
- **F11 (Low)** — `ALLOWED_HOSTS` accepts `.vercel.app`,
  `.appspot.com`, `.run.app` wildcards — any tenant on those
  platforms can pass the Host check.
- **F12 (Low)** — `{'error': str(e)}` payloads from legacy JSON
  views reach clients verbatim through `_adapt`'s `detail`
  passthrough — internal exception text (including upstream API
  bodies) leaks.
- F13 (plaintext OAuth tokens in the DB) is recorded as an
  accepted risk — field-level encryption is out of scope for a
  personal app.

## What Changes

- OAuth callback validates `state` before `fetch_token`; the
  `next`/redirect target is validated against
  `url_has_allowed_host_and_scheme` (or resolved as a view name)
  with a dashboard fallback.
- Cloud-environment settings gain `SESSION_COOKIE_SECURE`,
  `CSRF_COOKIE_SECURE`, `SECURE_SSL_REDIRECT` and a small HSTS
  max-age — gated to cloud deploys only so local HTTP dev keeps
  working.
- `OAUTHLIB_INSECURE_TRANSPORT` is set only when `BASE_URL` is
  plain `http://` (local dev), not on `DEBUG` alone.
- The `session['google_credentials']` write is dropped.
- `ALLOWED_HOSTS` is narrowed to the real hostnames (exact
  Cloud Run/Vercel domains + localhost).
- Legacy `{'error': str(e)}` sites return generic messages;
  exception detail stays in logs/Sentry.
- The dead `views.audio` handler (route already commented out)
  is removed with its `str(e)` bodies.

## Capabilities

### New Capabilities

- `google-oauth`: the Google OAuth2 login/callback flow —
  state-parameter validation, redirect-target validation, and
  credential-storage hygiene.
- `deployment-hardening`: transport/host hardening of deployed
  environments — secure cookie flags, HTTPS redirect + HSTS,
  `ALLOWED_HOSTS` scoping, dev-only OAuth HTTP allowance.

### Modified Capabilities

- `api-contract`: extends the error-envelope rule to handled
  failures — internal exception text MUST NOT reach clients via
  `detail`, including through `_adapt`'s passthrough of legacy
  `{'error': …}` payloads.

## Impact

- `google_api/utils.py` (callback state check, session-cred
  write, OAUTHLIB gating), `google_api/views.py` (`next`
  validation, dead `audio` view), `django_apps/settings.py`
  (secure flags, `ALLOWED_HOSTS`), `google_tasks/views.py`
  (`str(e)` sites), `django_apps/api.py` (`_adapt` detail
  handling).
- Behavior changes: parallel-tab OAuth flows may need a retry
  (single `session['state']` slot — accepted); session-less
  callback hits hard-fail (correct); Host-header spoofing on
  shared platform domains stops working.
- `ALLOWED_HOSTS` tightening MUST keep the real Cloud Run
  hostname and the live Vercel domain or the site goes down —
  verify exact values before editing.
