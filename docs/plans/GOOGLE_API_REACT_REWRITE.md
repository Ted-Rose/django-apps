# google_api React rewrite — Gmail reader, with a `gmail` app split

> **Status**: 📋 Plan. The platform built for google_tasks
> (`frontend/` workspace, `django_apps/api.py` NinjaAPI,
> `spa_shell`/`react_app`/`app_redirect` in `django_apps/views.py`,
> django-vite, generated types, TanStack Query, `shared/`
> client/NavBar/Modal/Dropdown/Toasts) is live and deploy-verified —
> see `GOOGLE_TASKS_REACT_REWRITE.md`; finance is mid-strangler on it
> (`FINANCE_REACT_REWRITE.md`). Root-mount adaptations are already
> designed in `SINGLE_PAGES_REACT_REWRITE.md`,
> `TV_ARCHIVE_REACT_REWRITE.md` and `BIBLE_RESEARCH_REACT_REWRITE.md`.
> This rewrite adds one Vite entry and one thin Django app; **no
> Docker, Vercel, CI, or settings changes are needed**.

## Application analysis — what `google_api` actually is

The app is **three responsibilities in one package** (~1,124 lines):

| Responsibility | Code | Consumers |
|---|---|---|
| **Google OAuth2 platform** — and the site's whole login system | `models.py` (`GoogleOAuthCredentials`, the per-user token store); `utils.py`: `google_auth`, `get_user_credentials`, `build_google_service`, `callback`, `BASE_SCOPES`/`ALL_APP_SCOPES`; `decorators.py`; `views.login_view`; routes `/login/`, `/google/callback` | `google_tasks` (`services.py` → `google_auth`, `views.py` → `get_user_credentials`, `api.py` → `GoogleOAuthCredentials` + `reverse('google_api:login')`); `decorators.google_auth_required`; **every site login** — `callback` creates/logs in Django `User`s and `LOGIN_URL='/login/'` points here |
| **Gmail feature** (the "Gmail to audio" reader) | `utils.py`: `get_messages`, `mark_messages_as_read`, `extract_text_from_html` (~180 lines incl. the `e-klase.lv` boilerplate special-case); `views.gmail`, `mark_emails_read`, `_gmail_reauth_response`; `templates/gmail.html`; routes `/gmail-to-audio`, `/gmail-mark-read`; `GMAIL_MODIFY_SCOPE` | nobody else — self-contained feature code that happens to live in the platform app |
| **Text-to-audio service** (gTTS → GCS signed URL) | `utils.py`: `text_to_audio`, `_sanitize_text_for_audio`, `AudioGenerationError` (~140 lines); `views.audio`; route `/text-to-audio` | `gmail.html` and `single_pages/twister.html` (both `fetch` it by URL). Not user-OAuth at all — uses GCP ADC service-account credentials |

So "is google_api a Google API layer or a Gmail provider?" — it's
both, plus a third thing. The Gmail feature is the squatter; the
platform and TTS are legitimately shared.

## Architecture decision — keep the core, extract the feature

| Option | Verdict |
|---|---|
| **A. Per-integration auth** — each feature app owns its OAuth (e.g. a `gmail` app with its own credential store) | **Rejected — not just overkill, harmful.** Google's model is ONE OAuth client accumulating scopes incrementally (`include_granted_scopes='true'`, `OAUTHLIB_RELAX_TOKEN_SCOPE`), one consent screen, one `redirect_uri` (`/google/callback`, registered in Cloud Console), one `GoogleOAuthCredentials` row per user. Duplicating it per integration means N token stores, N consent screens, N copies of the naive↔aware UTC expiry handling — and the OAuth `callback` *is* the site login, so it can't be split anyway. |
| **B. Status quo** — everything stays in `google_api`; the rewrite only replaces `gmail.html` | Viable, zero extra churn, but keeps the misleading name and the 771-line `utils.py` mixing auth/Gmail/TTS — the exact ambiguity that motivates this question. Every future Google integration piles further into the platform app. |
| **C. Shared core + feature apps** (chosen) — `google_api` becomes pure infrastructure (OAuth platform + shared GCP services); the Gmail feature moves to a new `gmail` Django app, symmetric with `google_tasks` | **Recommended.** The boundary is already real (nothing outside `google_api` imports the Gmail functions); `gmail` has **no models → zero migrations**; the move is ~300 lines of code motion, and the rewrite touches every layer anyway, so this is the cheapest the split will ever be. It also unlocks the repo's one-slug-everywhere convention — `/gmail/` mount, `/api/gmail/` router, `frontend/src/gmail/` entry — and makes `spa_url_for`'s default mapping work almost for free. |

**Dependency direction after the split:** `gmail` (feature) →
`google_api` (platform) → `django_apps` (shell). Never the reverse —
in particular `ALL_APP_SCOPES` keeps *literal* scope strings (it must
not `import gmail`), and `gmail` must not import `google_tasks`.

**Recipe for future Google integrations** (the payoff — record it in
`google_api/AGENTS.md` when the split lands): new Django app
`<feature>` → scope constant in `<feature>/services.py` + literal
added to `ALL_APP_SCOPES` → ninja router mounted at `/api/<slug>/` →
Vite entry `frontend/src/<slug>/` mounted at `/<slug>/`. OAuth,
credential storage, refresh, login — never duplicated.

## Decision

Extract the Gmail feature into a `gmail` app (Stage 0), then rewrite
its **user-facing UI** — the Gmail reader page at `/gmail-to-audio`
— as a React SPA on the shared platform:

- `gmail/` — new Django app (no models, no admin, no migrations):
  `services.py` gets `get_messages`/`mark_messages_as_read`/
  `extract_text_from_html` + `GMAIL_READONLY_SCOPE`/
  `GMAIL_MODIFY_SCOPE` constants; `views.py` gets `gmail`,
  `mark_emails_read`, `_gmail_reauth_response`; `templates/gmail.html`
  moves verbatim (deleted at cutover); `api.py` — a django-ninja
  `Router` mounted on the shared `NinjaAPI` as `/api/gmail/`
  (`api.add_router('/gmail/', gmail_router)` in
  `django_apps/urls.py`). One OpenAPI spec, types regenerated into
  `frontend/src/gmail/api-types.ts`.
- `frontend/src/gmail/` — new Vite entry (`main.tsx`,
  `BrowserRouter basename='/gmail'`), reusing `frontend/src/shared/`
  wholesale.
- Strangler adapted for the **root mount**: both urlconfs are
  included at `path('', …)` in `django_apps/urls.py`, so there is no
  `/<app>/` prefix to stage under — and `/app/` at root is already
  claimed by the single_pages plan. The SPA instead mounts at
  **`/gmail/`**, a free prefix, from its first stage. It is both the
  staging mount and the final canonical URL, so `basename` never
  flips (no `/gmail/app/` intermediate, no two-basename dance). At
  cutover `gmail-to-audio` 301s to `/gmail/` (preserving
  `?query=…`), and the URL **name** `gmail:index` moves to the
  `/gmail/` route — `home.html`'s `{% url 'gmail:index' %}` keeps
  working at every stage and lands directly on the SPA after
  cutover.

### One entry under a sub-path, not per-page shells

Single Vite entry `gmail` with `basename='/gmail'`. The app has
exactly one page today, so the entry has one route (`/` →
GmailReader) plus a `*` redirect — but it stays a real
`BrowserRouter` app rather than a bespoke shell, so it follows the
same client/NavBar/toasts/search-params machinery as tasks and
finance. If `gmail` ever grows a second unrelated page, follow the
single_pages pattern — basename-less absolute routes — rather than
stretching `/gmail/` beyond the reader.

### Explicitly out of scope

`google_api` remains the project's **shared Google platform**; the
split + SPA take only the Gmail feature. None of this changes:

- **OAuth plumbing stays Django views forever** —
  `path('login/', login_view)` (the unified auth entry:
  `google_api/decorators.py`, `google_tasks/api.py` `_reauth_url`
  and the session `next`/`oauth_redirect_url` flow all reverse it)
  and `path('google/callback', utils.callback)` (the `redirect_uri`
  baked into `utils.py` and registered in Google Cloud Console)
  stay in `google_api/urls.py` under the `google_api` namespace —
  external redirect targets, browser navigations that end in a
  Google round-trip, not fetches. They are not ninja operations and
  are not routed through any catch-all.
- **The platform service layer** — `utils.py`'s auth half
  (`google_auth`, `get_user_credentials`, `build_google_service`,
  `callback`, scope constants), `models.py`, `decorators.py`.
  `google_tasks` (`services.py`, `views.py`, `api.py`) imports these
  directly; they stay untouched, including the naive↔aware UTC
  credential-expiry conversions. `GOOGLE_APP_SECRETS_PATH` still
  points at `google_api/app_secrets.json`; `LOGIN_URL='/login/'`
  unchanged.
- **`text_to_audio` + `/text-to-audio`** — stay in `google_api`:
  it's a shared GCP service (also consumed by
  `single_pages/twister.html`), not a Gmail function and not
  user-OAuth. The legacy GET endpoint stays a Django view; it is
  deleted only when the single_pages rewrite removes the last
  caller (that plan already routes twister's audio through
  `GET /api/single_pages/tts/`).
- **`utils.py` modularization** (splitting the remainder into
  `auth.py`/`tts.py` with re-exports) — optional Stage-0 cleanup,
  not required; do it only if the PR stays small.

Django remains the backend: session auth, Gmail fetch, gTTS→GCS
pipeline — all unchanged.

## Current frontend surface (what's being replaced)

### Templates (1 file, 459 lines: `templates/gmail.html`)

| Template | Lines | Becomes |
|---|---|---|
| `gmail.html` | 459 | route `/` under basename `/gmail` — navbar + burger menu (Home / Tasks / Logout), query filter form, message cards (subject/sender/id, collapsible body), per-message + mark-all-read buttons, Play / Play-All-From-Here audio |

### JS (~270 lines, all inline in `gmail.html`)

| Block | React equivalent |
|---|---|
| filter form `?get_messages&query=` | `useSearchParams`; submit → `useQuery` on `/api/gmail/messages/`; auto-fetch when landing with a `query` or `get_messages` param (covers the 301'd legacy URL and the post-OAuth `oauth_redirect_url`) |
| `markMessagesAsRead` + `getCookie` | `useMutation` → `POST /api/gmail/mark-read/` via `shared/api/client.ts` (CSRF cookie handled there); `reauth_required` arrives as standard `401 google_reauth` → the client navigates to `authorization_url` |
| `markCardAsRead` / `handleMarkReadError` | per-card read state + toast on failure (`shared/toasts.ts`); `confirm()` dialog kept |
| body show/hide toggle | per-card boolean state |
| `createAudio` (fetch `/text-to-audio`, append `<audio>`) | `useAudioQueue` — `GET /api/gmail/audio/` results cached per message id, `<audio controls>` rendered in the card |
| `createAllAudios` / `autoplayAudios` | same hook — builds the **circular** playback order starting at the clicked card (`i = (i+1) % len` wraps end→start — parity, odd as it is), lazily fetches missing audio URLs, plays sequentially via `loadeddata`/`ended` listeners |
| 2300-char client truncation | kept verbatim — the audio GET URL stays under limits even after `encodeURIComponent` (~2× expansion vs the 5000-char backend cap) |
| inline `<style>` (~30 lines) | `gmail.css` imported into the entry |

Note on the Play button: the template calls
`createAllAudios(messageId, playOnlyCurrent = true)` — sloppy-mode
assignment passing `true`, so "Play" generates and plays **only
that message's** audio while "Play All From Here" plays the whole
circular queue. Reproduce that split deliberately in
`useAudioQueue`, not by accident.

### Backend surface

- **Stage-0 code motion** (no behavior change): `get_messages`,
  `mark_messages_as_read`, `extract_text_from_html`,
  `GMAIL_MODIFY_SCOPE` (+ a `GMAIL_READONLY_SCOPE` constant for the
  repeated literal) → `gmail/services.py`; `views.gmail`,
  `mark_emails_read`, `_gmail_reauth_response` → `gmail/views.py`;
  `gmail.html` → `gmail/templates/`. `google_api/views.py` keeps
  `login_view` and `audio`; `google_api/utils.py` keeps the auth +
  TTS halves; `ALL_APP_SCOPES` keeps the gmail scope strings as
  literals (no `import gmail` — platform must not depend on the
  feature).
- **Read views → GET endpoints** (1 ported + 1 new):
  - `gmail`'s `?get_messages` branch →
    `GET /api/gmail/messages/?query=` — same
    `get_user_credentials(user, [gmail.readonly])` →
    `gmail.services.get_messages(query, creds_dict)` call path; the
    `{'authorization_url', 'state', 'scopes'}` dict branch stores
    OAuth state in the session (same keys as the view) and raises
    `GoogleReauthRequired` instead of `redirect()`.
  - NEW `GET /api/gmail/status/` — the API equivalent of
    `@google_auth_required`'s eager check (credentials row,
    `gmail.readonly` in scopes, refresh usable). The decorator
    currently redirects before the page renders; the SPA calls
    status on mount and navigates to `/login/?next=<spa url>`
    itself when `has_credentials` is false.
- **Mutations → POST operations** (1): `gmail-mark-read` →
  `POST /api/gmail/mark-read/` — **delegates** to
  `gmail.views.mark_emails_read` via the shared `_adapt` (the view
  already emits the `{success: false, reauth_required,
  authorization_url}` shape `_adapt` maps to `401 google_reauth`,
  and stores OAuth session state itself via
  `_gmail_reauth_response`).
- **Audio → GET operation** (1): `GET /api/gmail/audio/?text=&lang=
  &filename=` — typed, session-authenticated sibling of the legacy
  `/text-to-audio`, wrapping `google_api.utils.text_to_audio` (the
  function stays in the platform app; the endpoint lives with the
  feature). Same `{audio_url}` shape; `ValueError` → 400,
  `AudioGenerationError`/other → 502 `upstream_error` (the legacy
  view's 500 maps to the API error taxonomy; matches the
  `single_pages` plan's `tts` op).
- **Unchanged Django views**: `login/`, `google/callback`,
  `text-to-audio` — see "out of scope".

## API contract (`gmail/api.py`, mounted at `/api/gmail/`)

```
GET  /api/gmail/status/                       → GmailStatusOut
GET  /api/gmail/messages/?query=              → GmailMessagesOut
POST /api/gmail/mark-read/   {message_ids: [str]} → {'success': true}
GET  /api/gmail/audio/?text=&lang=&filename=  → AudioOut
```

### Shared-layer changes (Stage 1, `django_apps/api.py`)

- **Promote `_adapt` and `_reauth_url`** from
  `google_tasks/api.py` into `django_apps/api.py`. The mark-read
  op delegates to `gmail.views.mark_emails_read` the same way tasks
  ops delegate to their JSON handlers, and `gmail` must not import
  `google_tasks` (feature→feature coupling). Tasks `api.py`
  switches to the shared import — mechanical, zero behavior change.
- **`spa_url_for` per-app base map.** Today it rewrites
  `/api/<app>/<sub>` → `/<app>/<sub>` — for a single-page mount
  that produces URLs like `/gmail/messages/?query=…`, a path the
  SPA's router doesn't have (it serves state at `/gmail/?query=…`).
  Add `SPA_BASES = {'gmail': '/gmail'}`: apps in the map are
  single-page mounts, so the API subpath collapses to the base and
  only the query string survives —
  `/api/gmail/messages/?query=is:unread` →
  `/gmail/?query=is:unread`, which is exactly the SPA's own
  shareable state (the reader auto-fetches on `?query=`). The same
  map gets a `'single_pages'` entry when that plan lands
  (its Stage 0 already calls for this mechanism); default for
  unmapped apps stays `/<app>/`.
- With `spa_url_for` fixed, the promoted `_reauth_url`
  (`reverse('google_api:login')?next=<spa url>`) works unchanged —
  `google_api:login` keeps its namespace — both for `_adapt`'s
  creds-missing path and the shared `unauthenticated` handler's
  `login_url`.

### Schemas (Pydantic, source of the generated TS types)

```
GmailMessageOut:  id, subject, sender, body
GmailMessagesOut: messages: List[GmailMessageOut], query
GmailStatusOut:   has_credentials, scopes: List[str]
MarkReadIn:       message_ids: List[str] (non-empty — the view
                  400s on empty/missing lists)
AudioOut:         audio_url
```

`scopes` in the status response lets the SPA disable mark-read
buttons when `gmail.modify` isn't granted — cosmetic only; the
401-bounce on click is the real path, same as the template today
(the page only requires `gmail.readonly`).

Type generation — same workflow:

```bash
python manage.py export_openapi_schema --api django_apps.api.api \
  > frontend/openapi.json
npm run gen:types --prefix frontend
```

`gen:types` becomes three commands or — better, and already
anticipated by the single_pages plan — a loop over
`[tasks, finance, gmail]` emitting one `api-types.ts` per
entry from the single committed `openapi.json`. Whichever plan
lands first introduces the loop; rebase the other on top.

## URL & cutover design

`google_api/urls.py` after Stage 0 — **unchanged at every later
stage** (platform routes only):

```python
app_name = 'google_api'

urlpatterns = [
    path('login/', views.login_view, name='login'),
    path('google/callback', callback, name='callback'),
    # Shared JSON endpoint — twister.html fetches it until the
    # single_pages rewrite removes the last caller.
    path('text-to-audio', views.audio, name='audio'),
]
```

`gmail/urls.py` at Stage 0 (pure move — only the legacy routes):

```python
app_name = 'gmail'

urlpatterns = [
    # 'index' = the Gmail reader page at every stage; home.html
    # reverses gmail:index and lands here during staging.
    path('gmail-to-audio', views.gmail, name='index'),
    path('gmail-mark-read', views.mark_emails_read,
         name='mark_emails_read'),
]
```

…plus the SPA mount from Stage 2 (also the final canonical URL):

```python
react_app_gmail = partial(
    react_app, entry='gmail', title='Gmail to Audio'
)

urlpatterns += [
    path('gmail/', react_app_gmail, name='spa_app'),
    path('gmail/<path:subpath>', react_app_gmail,
         name='spa_app_subpath'),
]
```

At cutover the `gmail/` mount is canonical and `gmail-to-audio`
becomes a permanent redirect:

```python
app_redirect_gmail = partial(app_redirect, base='gmail')

urlpatterns = [
    # Legacy page URL → canonical SPA mount; app_redirect keeps
    # the query string, so ?get_messages&query=… bookmarks land
    # on /gmail/?get_messages&query=… and the SPA auto-fetches.
    path('gmail-to-audio', app_redirect_gmail, name='legacy'),
    # 'index' name moves here — home.html + brand links reverse it.
    path('gmail/', react_app_gmail, name='index'),
    path('gmail/<path:subpath>', react_app_gmail,
         name='spa_subpath'),
]
```

`react_app` and `app_redirect` are already the shared helpers in
`django_apps/views.py`. Non-GET/HEAD requests under `gmail/` 404
post-cutover; `gmail-mark-read`'s route is deleted outright (POSTs
to it hit no route → 404 — the retired mutation URL must not
answer with the HTML shell). `gmail.views.mark_emails_read` itself
**stays** (unrouted) because the API op delegates to it — same
shape as the tasks handlers.

`django_apps/urls.py`: `path('', include('gmail.urls',
namespace='gmail'))` immediately **after** the `google_api`
include (keeps the platform's root-mounted routes first, matching
include-order precedent).

One housekeeping edit at cutover: `_gmail_reauth_response`'s
`HTTP_REFERER or '/gmail-to-audio'` fallback flips to `'/gmail/'`
(harmless either way — the old URL 301s, and Referer is the SPA
page in practice).

## Frontend layout

```
frontend/src/gmail/
  main.tsx            # createRoot + BrowserRouter basename='/gmail'
  App.tsx             # Routes: / → GmailReader; * → Navigate '/'
  api-types.ts        # generated — do not edit
  api.ts              # typed fetchers over shared/api/client.ts
  mutations.ts        # mark-read mutation → toasts
  gmail.css           # ported inline styles
  routes/
    GmailReader.tsx   # status gate → filter form → list +
                      # mark-all-read
  components/
    GmailNavBar.tsx       # brand 'Gmail to Audio' + burger menu
                          # (Home / Tasks / Logout — mirrors
                          # views.gmail's burger_menu_items)
    MessageCard.tsx       # subject/sender/id, body toggle,
                          # mark-read, Play buttons, <audio> slot
    useAudioQueue.ts      # per-message audio URL cache + circular
                          # sequential playback
```

The search query lives in `?query=` (`useSearchParams`) — the URL
stays shareable/bookmarkable, the `gmail-to-audio` 301 preserves
it, and `spa_url_for` round-trips it through OAuth `next`.

`spa_shell.html` needs no changes (Bootstrap CDN + `pwa/head.html`
already included). `confirm()` stays `confirm()` — the existing
modals convention isn't needed for a two-button page.

## Stages

Every merged stage deploys to prod; `/gmail-to-audio` keeps serving
the template until the last stage. One PR per stage. Whole scope
is days — stages 3–4 may be merged if the PR stays reviewable.

| Stage | Scope |
|---|---|
| 0. App split | `startapp gmail` (no models/admin/migrations); move Gmail code → `gmail/services.py` + `gmail/views.py` + `gmail/templates/gmail.html`; `gmail/urls.py` (legacy routes only, `app_name='gmail'`, name `index` on `gmail-to-audio`); `google_api/urls.py` shrinks to `login/`/`callback`/`text-to-audio`; `ALL_APP_SCOPES` literals + `GMAIL_MODIFY_SCOPE` import move; `INSTALLED_APPS += 'gmail'`; include `gmail.urls` after `google_api` in `django_apps/urls.py`; `home.html` + `gmail.html` `{% url %}` names → `gmail:*`; `views.gmail` keeps working (imports now `gmail.services`, decorator stays `google_api.decorators`); `manage.py check` + `test google_api google_tasks` — pure refactor, zero URL/behavior change |
| 1. API | `gmail/api.py` router + schemas; `api.add_router('/gmail/', …)`; promote `_adapt`/`_reauth_url` to `django_apps/api.py` + `SPA_BASES` in `spa_url_for`; switch `google_tasks/api.py` to the shared imports; Django tests in `gmail/tests.py`: unauthenticated → 401 JSON, CSRF on POST, messages with no/dead creds → `401 google_reauth` whose `authorization_url` is `/login/?next=/gmail/…`, auth-dict passthrough stores `state`/`oauth_scopes`/`oauth_redirect_url` in session, mark-read delegation (incl. empty list → 400, reauth payload → 401), audio `ValueError` → 400 / `AudioGenerationError` → 502 (mock `google_api.utils.text_to_audio`); export `openapi.json` |
| 2. SPA mount | `frontend/src/gmail/` skeleton (main/App/NavBar/route stub); Vite `input.gmail`; `gen:types` third output (or the entry loop); `gmail/` + `gmail/<path:subpath>` routes in `gmail/urls.py`; bump `PWA_CACHE_VERSION` |
| 3. Gmail reader | status gate (`/login/?next=` navigation on `has_credentials: false`), filter form + `?query=` state, auto-fetch on `query`/`get_messages` params, message list, `MessageCard` body toggle, mark-read + mark-all-read with confirm dialogs and toasts; parity check vs `/gmail-to-audio` on the same query |
| 4. Audio + tests | `useAudioQueue` (per-message fetch cache, circular order, sequential `ended` playback, 2300-char truncation); Play / Play-All-From-Here; Vitest/RTL for queue ordering + mark-read flow; Playwright `gmail.smoke.spec.ts` (load `/gmail/`, submit a query with mocked API, mark one read) |
| 5. Cutover | URL swap above; `gmail-to-audio` → 301 preserving query (keep name as `legacy`, move `index` to the `/gmail/` route); delete `gmail.html`, `gmail.views.gmail`, the `gmail-mark-read` **route** (keep the view — api delegates); flip `_gmail_reauth_response` fallback to `/gmail/`; update `google_api/AGENTS.md` + `README.md` (now platform-only: URL table drops gmail routes, add the "new integration recipe"), new `gmail/AGENTS.md`, root `AGENTS.md` (repo map: split the `google_api/` row, "SPA like tasks/finance" note); bump `PWA_CACHE_VERSION` |

## Risks / gotchas

- **OAuth callback must stay server-side and unroutable by any
  catch-all.** `/google/callback` is the `redirect_uri` registered
  in Google Cloud Console and built in `utils.py`; `/login/` is
  the entry `decorators.py`, `google_tasks/api.py` and stored
  session `next` values point at — and it's the site's
  `LOGIN_URL`. Both keep their exact paths, stay in
  `google_api/urls.py` under the `google_api` namespace, and stay
  plain Django views — the `gmail/<path:subpath>` catch-all can't
  reach them by construction.
- **Never add a root-level catch-all.** Both `google_api.urls`
  and `gmail.urls` are included at `path('', …)` *before*
  `single_pages`, `tv_archive`, `bible_research` and `views.home`
  — a bare `<path:subpath>` in either would swallow all of them.
  The only catch-all is `gmail/<path:subpath>`, scoped to the SPA
  prefix.
- **`/app/` is taken.** The single_pages plan stages its SPA at
  site-root `/app/`; do not reuse it — `/gmail/` is both our
  staging and canonical prefix, which is also why no basename flip
  is needed (unlike bible's `/bible/app` → `/bible` dance).
- **URL-name moves at Stage 0.** `{% url 'google_api:gmail' %}`
  (home.html, gmail.html brand link) and `{% url
  "google_api:mark_emails_read" %}` (gmail.html) become `gmail:*`
  names the moment the routes move urlconfs — a stale name is a
  `NoReverseMatch` 500, so stage-0 review = grep for
  `google_api:` in templates + render both pages. `google_api:
  login`/`callback`/`audio` names do not move.
- **`ALL_APP_SCOPES` keeps literal gmail scope strings.** The
  constant moves to `gmail/services.py` (`GMAIL_MODIFY_SCOPE`),
  but the platform listing must not `import gmail` — duplicating
  the two scope literals is deliberate; leave a comment so future
  integrations follow the recipe instead of re-importing.
- **Session writes from ninja ops.** The messages op stores
  `state`/`oauth_scopes`/`oauth_redirect_url` when `get_messages`
  returns the auth dict — same keys the views write; ninja hands
  the real request, but cover the write in a test. Set
  `oauth_redirect_url` to `spa_url_for(request)`
  (`/gmail/?query=…`) so the callback returns to the SPA, not to
  an `/api/` JSON URL.
- **`_gmail_reauth_response` uses `HTTP_REFERER`** for
  `oauth_redirect_url` — fetches from the SPA send
  `Referer: /gmail/?query=…`, so the OAuth round-trip lands back
  on the right page automatically. Verified same-origin only by
  convention; the F2 open-redirect fix (SECURITY_AUDIT_FIXES.md)
  remains a separate, still-open change to the OAuth layer — out
  of scope here, as are F1 (callback doesn't validate `state`).
- **F3 is only half-addressed by design.** `/text-to-audio` stays
  unauthenticated because `twister.html` is a public page and its
  only caller besides gmail.html. The new `/api/gmail/audio/`
  is session-authed, so the SPA never touches the open endpoint;
  full F3 closure belongs to the single_pages rewrite (which moves
  twister to `/api/single_pages/tts/` and can then gate or delete
  `/text-to-audio`). Don't "fix" it here — that would break
  twister anonymously.
- **Audio-op overlap with `single_pages`.** That plan also specs a
  `tts` op wrapping `text_to_audio`. Both are ~10-line wrappers
  over the platform function; keep `/api/gmail/audio/` as the
  canonical one for the reader and let single_pages' op
  delegate-or-duplicate as it lands — not worth a cross-router
  import.
- **`get_messages` is N+1 Gmail calls** (1 list + 1 get per
  message, `maxResults=100`) — unchanged from today; keep it ONE
  endpoint returning everything (the Vercel `max_connections`
  lesson). The 10-30s fetch time is existing behavior; the SPA
  needs a real loading state the template never had.
- **Status check does a Google token refresh** when the access
  token is expired — same cost the decorator pays per page load
  today. One extra request per SPA mount; fine.
- **Eager-bounce parity.** The decorator redirects unauthenticated/
  unscoped users before render; the SPA's status gate must do the
  same (navigate on `has_credentials: false`) rather than show a
  dead filter form — otherwise a logged-in user without Google
  creds sees a page that only 401s on submit. Same potential
  consent-decline loop exists today; parity accepted.
- **Circular "Play All" order** wraps from the clicked message to
  index 0 — counterintuitive but existing behavior; port it
  byte-for-byte before considering a fix.
- **`session['state']` is a single OAuth slot** — parallel flows
  in two tabs still last-write-win (pre-existing, see the F1
  audit note); the SPA doesn't change this.
- **Both UIs live between stages 2–5** on the same code path —
  identical semantics because the API calls the same
  `get_messages`/`mark_messages_as_read`/`views.mark_emails_read`;
  no dual-write risk (read-only Gmail + one mutation).
- **`mark_emails_read` keeps `@login_required @require_POST`** when
  delegated — ninja's `django_auth` + CSRF already covers it, but
  the decorators are harmless and keep the view safe if it's ever
  re-routed.
- **`google_auth_required` loses its last caller at cutover**
  (only `views.gmail` used it). Keep it in `google_api` anyway —
  it's platform API for future template-rendered pages — but note
  it in `google_api/AGENTS.md` as currently-unconsumed.

## Verification checklist (per stage)

```bash
source venv/bin/activate
python manage.py check
python manage.py test gmail google_api google_tasks   # all three —
                            # api.py import switch in Stage 1
npm run typecheck --prefix frontend && npm run lint --prefix frontend
python manage.py export_openapi_schema --api django_apps.api.api \
  > frontend/openapi.json && npm run gen:types --prefix frontend
  # → git diff must be empty for committed artifacts
```

Manual UI checks per stage: compare `/gmail-to-audio` (template)
against `/gmail/` (SPA) on the same query — same messages, same
bodies; mark one read in each UI and confirm it sticks; run one
full Play-All sequence on both; after cutover verify
`/gmail-to-audio?get_messages&query=is:unread` 301s to
`/gmail/?…` and auto-fetches.
