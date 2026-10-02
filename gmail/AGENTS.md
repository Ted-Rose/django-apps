# gmail — Agent Guide

The "Gmail to audio" reader — fetch Gmail messages matching a query,
read them, mark them read, play them as audio. Split out of
`google_api` in the React rewrite: `google_api` is the shared OAuth
platform, this app is a pure feature app depending on it (the
platform never imports gmail; `gmail` must not import
`google_tasks` or other feature apps — shared helpers like
`_adapt`/`_reauth_url` live in `django_apps.api`).

No models, no admin, no migrations — everything lives in Google and
the session.

## Layout

- `services.py` — `get_messages(query, creds)` (Gmail fetch with
  MIME parsing + the `e-klase.lv` boilerplate special-case),
  `mark_messages_as_read(creds, ids)` (batchModify removing UNREAD),
  `extract_text_from_html`, and the scope constants
  `GMAIL_READONLY_SCOPE` / `GMAIL_MODIFY_SCOPE` (the same strings
  are duplicated as literals in `google_api.ALL_APP_SCOPES` —
  deliberate, per the dependency direction).
- `views.py` — `mark_emails_read` + `_gmail_reauth_response` only.
  The JSON view is **not URL-routed** — `POST /api/gmail/mark-read/`
  delegates to it via `django_apps.api._adapt` (same shape as the
  tasks handlers). The old `gmail` template view was deleted at
  cutover.
- `api.py` — ninja router mounted at `/api/gmail/`:
  `GET status/` (eager credential check the SPA gates on),
  `GET messages/?query=` (the reader fetch; auth dict → OAuth
  session state + `401 google_reauth`),
  `POST mark-read/` (delegates to the view),
  `GET audio/?text=&lang=&filename=` (session-authed wrapper over
  `google_api.utils.text_to_audio`; `ValueError` → 400, pipeline
  failures → 502 `upstream_error`).
- `urls.py` — `gmail-to-audio` 301s to `/gmail/` preserving the
  query string; `gmail/` + `gmail/<path:subpath>` serve the SPA
  shell (`react_app`); `gmail:index` names the SPA route so
  `home.html`'s `{% url 'gmail:index' %}` keeps working. Mounted at
  root in `django_apps/urls.py` — **never add a bare
  `<path:subpath>` catch-all**, only the `gmail/` prefix.

## Frontend

`frontend/src/gmail/` — Vite entry `gmail`,
`BrowserRouter basename='/gmail'`, single route (`/` → GmailReader).
The reader gates on `/api/gmail/status/` (bounces to
`/login/?next=` when `has_credentials` is false), keeps the Gmail
query in `?query=` (auto-fetches when the URL carries `query` or the
legacy `get_messages` param — that covers 301'd `/gmail-to-audio`
bookmarks and the post-OAuth `oauth_redirect_url`). Audio playback
is `components/useAudioQueue.ts`: per-message audio URL cache, the
template's circular Play-All order (`i=(i+1)%len`, wraps end→start)
and the 2300-char truncation — all deliberate parity ports.

## Gotchas

- `get_messages` is N+1 Gmail API calls (1 list + 1 get per message,
  `maxResults=100`) — the reader can take 10–30s; the SPA shows a
  real loading state.
- The `oauth_redirect_url` session key must point at the SPA page
  (`spa_url_for(request)` → `/gmail/?query=…`, via `SPA_BASES` in
  `django_apps/api.py`), never at an `/api/` JSON URL.
- `_gmail_reauth_response` reads `HTTP_REFERER` for the redirect
  (the SPA's fetches send `Referer: /gmail/…`); `'/gmail/'` is just
  the fallback.
- `/text-to-audio` stays in `google_api` (legacy public endpoint,
  no in-repo callers left) — the SPA only ever calls
  `/api/gmail/audio/`.
