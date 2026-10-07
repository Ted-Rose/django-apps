# google_api — Agent Guide

The shared Google OAuth2 **platform** plus the text-to-audio service
(gTTS → GCS signed URLs). The Gmail reader feature moved to the
`gmail` app in the React rewrite — this app is infrastructure only.
Feature apps (`gmail`, `google_tasks`) depend on this app's auth
utilities; `google_api` must never import them. Full docs:
`README.md` in this directory.

## Architecture

- `models.py` — `GoogleOAuthCredentials` (one per user): access_token,
  refresh_token, token_expiry, scopes. **This is the source of truth
  for Google credentials** — the session-based
  `request.session['google_credentials']` dict exists only for
  backward compatibility.
- `utils.py` — all the machinery:
  - `ALL_APP_SCOPES` — openid, userinfo.email, gmail.readonly,
    gmail.modify, tasks. `login_view` requests all of them at once.
    Feature-app scope constants live in `<feature>/services.py`
    (e.g. `gmail.services.GMAIL_MODIFY_SCOPE`) but are duplicated
    here as literals on purpose — the platform must not import
    feature apps.
  - `google_auth(creds, scopes, user)` — central entry point. Returns a
    `Credentials` object **or** a dict
    `{'authorization_url', 'state', 'scopes'}` when reauth is needed.
    Every caller must handle the dict case.
  - `get_user_credentials(user, scopes)` — load creds from DB, refresh
    the token if expired, persist the new token. Returns `None` if
    missing, scopes insufficient, or the refresh fails (e.g. revoked
    token → `RefreshError` is caught, callers treat as re-auth).
  - `build_google_service(name, version, creds, scopes)` — generic
    API client builder.
  - `callback(request)` — OAuth callback: exchanges code, logs the user
    in (creates a Django `User` keyed on Google **email**, username =
    email local-part), saves creds to DB, redirects to
    `session['oauth_redirect_url']` (strips `sync` param to avoid an
    auth loop).
  - `text_to_audio(text, lang, filename)` — gTTS → upload to GCS
    `recordings/` → v4 signed URL (7 days, matches bucket lifecycle).
    Requires `GCS_AUDIO_BUCKET` env var + GCP credentials.
- `decorators.py` — `@google_auth_required(scopes=[...])`: redirects to
  `google_api:login` when unauthenticated, scopes missing, or stored
  credentials are unusable. **Currently unconsumed** — it lost its
  last caller when the gmail template page was deleted at cutover;
  kept as platform API for future template-rendered pages.
- `views.py` — `login_view` (unified auth entry — every feature's
  reauth bounce points at `google_api:login`, and it's the site's
  `LOGIN_URL`) and `audio` (`/text-to-audio` GET endpoint — legacy
  **unauthenticated** TTS service; the single_pages rewrite removed
  its last in-repo caller (twister.html) and the SPAs use the
  session-authed `/api/gmail/audio/` + `/api/single_pages/tts/` ops,
  so gating or deleting it is now a free decision — security finding
  F3). `urls.py` routes `login/`, `google/callback` (the
  `redirect_uri` registered in Google Cloud Console) and
  `text-to-audio` — all plain Django views, never ninja ops, and
  never behind a root-level catch-all.

## Recipe: adding a new Google integration

New Django app `<feature>` → scope constant in
`<feature>/services.py` **plus the literal added to
`ALL_APP_SCOPES`** → ninja router in `<feature>/api.py` mounted at
`/api/<slug>/` (`api.add_router` in `django_apps/urls.py`; use the
shared `_adapt`/`_reauth_url`/`GoogleReauthRequired` from
`django_apps.api`) → Vite entry `frontend/src/<slug>/` mounted at
`/<slug>/` via `react_app`. OAuth, credential storage, refresh and
login are never duplicated — always go through `google_auth` /
`get_user_credentials` here. Feature apps must not import other
feature apps (that's why `_adapt`/`_reauth_url` were promoted to
`django_apps/api.py`).

## Gotchas

- **Naive vs aware datetimes**: google-auth expects naive-UTC `expiry`;
  Django stores timezone-aware. Conversion logic lives in
  `get_user_credentials` and `callback` — reuse them, don't hand-roll
  `Credentials`.
- Client secrets file path comes from `settings.GOOGLE_APP_SECRETS_PATH`
  (`/tmp/app_secrets.json` on GCP, `google_api/app_secrets.json`
  locally — written from env var at settings import).
- `OAUTHLIB_INSECURE_TRANSPORT=1` is set module-wide for local dev;
  `OAUTHLIB_RELAX_TOKEN_SCOPE=1` is required because
  `include_granted_scopes='true'` returns extra granted scopes.
- `AudioGenerationError` for pipeline failures, `ValueError` for bad
  input (max 5000 chars). Language detection restricted to lv/en.
- Signed URLs use the IAM `signBlob` path
  (`service_account_email` + `access_token`) on Cloud Run because the
  metadata-server creds have no private key; on Vercel,
  `GCP_SERVICE_ACCOUNT_JSON` (the `vercel-audio` SA key) becomes
  `GOOGLE_APPLICATION_CREDENTIALS` → `service_account.Credentials`,
  which signs locally.
