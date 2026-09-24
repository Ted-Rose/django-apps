# google_api — Agent Guide

Shared Google OAuth2 layer plus the "Gmail to audio" feature. Other
apps (google_tasks) depend on this app's auth utilities. Full feature
docs: `README.md` in this directory.

## Architecture

- `models.py` — `GoogleOAuthCredentials` (one per user): access_token,
  refresh_token, token_expiry, scopes. **This is the source of truth
  for Google credentials** — the session-based
  `request.session['google_credentials']` dict exists only for
  backward compatibility.
- `utils.py` — all the machinery:
  - `ALL_APP_SCOPES` — openid, userinfo.email, gmail.readonly, tasks.
    `login_view` requests all of them at once.
  - `google_auth(creds, scopes, user)` — central entry point. Returns a
    `Credentials` object **or** a dict
    `{'authorization_url', 'state', 'scopes'}` when reauth is needed.
    Every caller must handle the dict case.
  - `get_user_credentials(user, scopes)` — load creds from DB, refresh
    the token if expired, persist the new token. Returns `None` if
    missing/scopes insufficient.
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
  - `get_messages(query, creds)` — Gmail fetch with MIME parsing; has
    special-case boilerplate stripping for `e-klase.lv` sender.
- `decorators.py` — `@google_auth_required(scopes=[...])`: redirects to
  `google_api:login` when unauthenticated or scopes missing.
- `views.py` — `login_view` (unified auth entry),
  `gmail` (`/gmail-to-audio`), `audio` (`/text-to-audio` GET endpoint).

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
- Signed URLs on Cloud Run use the IAM `signBlob` path
  (`service_account_email` + `access_token`) because no private key is
  available.
