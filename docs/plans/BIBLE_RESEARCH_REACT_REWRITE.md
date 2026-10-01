# Bible Research React Rewrite — third app on the shared platform

> **Status**: 📋 Plan. The platform built for google_tasks and
> extended by finance (`frontend/` workspace, `django_apps/api.py`
> NinjaAPI, `spa_shell`/`react_app`/`app_redirect`, django-vite,
> generated types, TanStack Query, `shared/` client/NavBar/Modal/
> Dropdown/Toasts) is live — see `GOOGLE_TASKS_REACT_REWRITE.md` and
> `FINANCE_REACT_REWRITE.md`. This rewrite adds a third Vite entry;
> **no Docker, Vercel, CI, or settings changes are needed**.
>
> Scope is tiny on purpose: one page, one read endpoint, one
> mutation, zero models. Anything not listed here stays untouched.

## Decision

Rewrite `bible_research` as a React SPA exactly the way `finance`
was:

- `bible_research/api.py` — a django-ninja `Router` mounted on the
  existing `NinjaAPI` as `/api/bible/`
  (`api.add_router('/bible/', bible_router)` in
  `django_apps/urls.py`). One OpenAPI spec, types regenerated into
  `frontend/src/bible/api-types.ts`.
- `frontend/src/bible/` — new Vite entry
  (`main.tsx`, `BrowserRouter basename='/bible/app'` → `'/bible'`
  at cutover), reusing `frontend/src/shared/` wholesale.
- Same strangler mount: SPA lives at **`/bible/app/`** while the
  template page keeps serving `/bible/`; the final stage swaps
  them and 301s `/bible/app/*` → `/bible/*`.

Django remains the backend: `get_word.get_verses` (the `api.esv.org`
client) and `serializers.esv_passages_to_json` are reused unchanged
by the API — the app is a thin ESV proxy, no models, no per-user
state.

### Three structural differences from finance/tasks

1. **Root-mounted app.** `bible_research.urls` is included under
   `path('')` in `django_apps/urls.py`; the `bible/` prefix lives
   inside the app's own `urls.py` (`bible/`, `bible/verses`). The
   strangler mount and cutover catch-all must stay scoped to
   `bible/` — a loose catch-all at root would swallow
   `google_api`/`single_pages`/`tv_archive` routes.
2. **A public cross-origin consumer.** `/bible/verses` is an
   unauthenticated JSON endpoint allow-listed for
   `https://reactive-bible.vercel.app` in `CORS_ALLOWED_ORIGINS`.
   Cross-origin `fetch` sends no session cookie (`SameSite=Lax`),
   so session auth **cannot** protect it — the security audit
   (F8 in `SECURITY_AUDIT_FIXES.md`) already concluded auth needs a
   token/throttle, not a decorator. This endpoint is therefore
   **not rewritten**: `views.verses` stays routed forever. The new
   `/api/bible/verses/` is added with `auth=None` (public, CORS
   still applies via middleware) as the single typed implementation
   — the SPA uses it, and reactive-bible can migrate to it later.
   F8 hardening remains separate work.
3. **The page goes from public to login-required.** `views.py` has
   no `@login_required` today; `spa_shell`/`react_app` bake it in.
   That is intended — it matches the platform convention
   ("`@login_required` on everything user-facing") and the audio
   POST burns ESV quota. The only public surface that must stay
   public is `/bible/verses`.

## Current frontend surface (what's being replaced)

### Template (~86 lines: `bible_research/templates/bible_research/`)

| Template | Lines | Becomes |
|---|---|---|
| `passage_form.html` | 86 | route `/` — passage input + submit, `<audio>` element, play/pause/repeat buttons; Bootstrap 4 CDN page |

### JS (~50 lines, inline in the template)

| Code | React equivalent |
|---|---|
| form `submit` handler → `fetch(POST {passage})` | `useMutation` → `apiPost('/api/bible/audio/', {passage})` |
| `atob` → `Uint8Array` → `Blob` → `createObjectURL` | `usePassageAudio` hook returning an object URL for `<audio src>` |
| `playAudio`/`pauseAudio`/`toggleRepeat` buttons | `<AudioPlayer>` component — `<audio controls>` already covers play/pause; keep a loop toggle |
| commented-out jumpBack/jumpForward | not ported (dead code) |

The current page never calls `/bible/verses` — it only makes audio.
The SPA adds a "show text" affordance using the verses endpoint
(same passage input), which the external app already relies on.

### Backend surface

- **Read → GET endpoint (1)**: `verses`
  (`GET /bible/verses?passage=&passages_format=`) →
  `{'verses': [{verse, text}, ...]}` (`json` format, default) or
  the raw ESV response dict (`raw`), or the string
  `'Passage not found'`. Errors: `{'error': str(e)}` 400.
  **Stays a Django view forever** (external consumer); the ninja
  op reuses `get_verses` + `esv_passages_to_json` directly.
- **Mutation → POST operation (1)**: `generate_audio` POST branch —
  `PassageForm` (one `passage` field, `max_length=100`) →
  `get_verses(passage, response_format='audio')` → mp3 bytes →
  `{'audio_content': base64}`.
- **Page view → SPA shell (1)**: `generate_audio` GET branch renders
  `passage_form.html`; replaced by `react_app`.
- **Not wired, not ported**: `search_bible`,
  `get_bible_chapters_and_verses`, `esv_bible_chapters.json` are
  dev scripts/data in `get_word.py` — `response_format='search'`
  is not exposed by any URL and stays that way.
- **External callers**: `home.html:127` uses
  `{% url 'bible_research:generate_audio' %}` — the name must keep
  resolving. No other `reverse()` callers exist.

## API contract (`bible_research/api.py`, mounted at `/api/bible/`)

```
GET  /api/bible/verses/?passage=&passages_format=json|raw
     → VersesOut            # auth=None — public, see Decision §2
POST /api/bible/audio/  {passage}
     → AudioOut             # session auth + CSRF (django_auth)
```

`verses` errors: missing `passage` → ninja 422 (param required);
ESV non-200 / network failure → `HttpError(502, 'upstream_error')`
with a sanitized detail — **not** `str(e)` (F12: the current view
leaks `resp.text` and exception internals). `audio` errors:
invalid/empty passage → 400; upstream failure → 502;
`get_verses` returning empty bytes → 502.

Mutation success returns `{'audio_content': '<base64 mp3>'}` —
same wire format the template consumes today. Binary `audio/mpeg`
streaming was rejected: `shared/api/client.ts` is JSON/text-oriented
and ESV passage audio is small; base64 keeps the generated types
trivial.

### Schemas (Pydantic, source of the generated TS types)

```
VerseOut:   verse: int, text: str
VersesOut:  verses: Union[List[VerseOut], dict, str]
            # json format  → [{verse, text}, ...]
            # raw format   → the full ESV response dict
            # not found    → 'Passage not found'
            # union keeps wire-compat with /bible/verses so the
            # external consumer can migrate unchanged
AudioIn:    passage: str = Field(min_length=1, max_length=100)
            # PassageForm parity
AudioOut:   audio_content: str   # base64 mp3
```

Type generation — same workflow, `gen:types` gains a third output:

```bash
python manage.py export_openapi_schema --api django_apps.api.api \
  > frontend/openapi.json
npm run gen:types --prefix frontend
  # emits src/tasks, src/finance AND src/bible api-types.ts
```

## URL & cutover design (`bible_research/urls.py`)

During staging (existing routes unchanged, mount first so `app/`
never falls into the page view):

```python
react_app_bible = partial(
    react_app, entry='bible', title='Bible'
)

urlpatterns = [
    path('bible/app/', react_app_bible, name='spa_app'),
    path('bible/app/<path:subpath>', react_app_bible,
         name='spa_app_subpath'),
    path('bible/verses', views.verses, name='verses'),
    path('bible/', views.generate_audio, name='generate_audio'),
]
```

At cutover — keep `bible_research:generate_audio` alive on the
shell route (it's the page `home.html` links to), keep
`bible/verses` routed to the real view **before** the catch-all,
and 301 the strangler mount:

```python
react_app_bible = partial(react_app, entry='bible', title='Bible')
app_redirect_bible = partial(app_redirect, base='/bible/')

urlpatterns = [
    # Public JSON endpoint — external consumer, stays a view.
    path('bible/verses', views.verses, name='verses'),
    # Every GET page name → SPA shell.
    path('bible/', react_app_bible, name='generate_audio'),
    # Legacy strangler mount → 301.
    path('bible/app', app_redirect_bible, name='react_app_noslash'),
    path('bible/app/', app_redirect_bible, name='react_app'),
    path('bible/app/<path:subpath>', app_redirect_bible,
         name='react_app_subpath'),
    path('bible/<path:subpath>', react_app_bible,
         name='spa_subpath'),
]
```

`react_app`/`app_redirect` are already shared in
`django_apps/views.py` (promoted there for finance) — only
`functools.partial` bindings are needed here. Non-GET/HEAD requests
under `/bible/` 404 post-cutover: `POST /bible/` (the retired audio
form post) must not answer with the shell — see Risks for the
external-consumer check. `POST /bible/verses` still hits the view,
which already answers 405 JSON.

`/bible/verses/` (trailing slash) matches only the catch-all → the
SPA `*` route bounces to `/` — acceptable; today's URL has no
trailing slash either.

## Frontend layout

```
frontend/src/bible/
  main.tsx            # createRoot + BrowserRouter
                      #   basename='/bible/app' → '/bible' at
                      #   cutover (same two-basename dance as
                      #   finance main.tsx)
  App.tsx             # Routes: '/' → Passage; '*' → Navigate '/'
  api-types.ts        # generated — do not edit
  api.ts              # fetchVerses(passage, format),
                      # fetchAudio(passage)
  usePassageAudio.ts  # mutation → base64 → Blob → objectURL
                      # (ports the template's atob/Uint8Array code);
                      # revokeObjectURL on replace
  routes/
    Passage.tsx       # the whole page: input, "Show text" +
                      # "Play audio" actions, verse list, player
  components/
    BibleNavBar.tsx   # shared NavBar + burger items:
                      # Home ('/'), Logout — the old page had no
                      # nav; mirrors the other SPAs
    VerseList.tsx     # renders VersesOut (list | raw dict | not-
                      # found string)
    AudioPlayer.tsx   # <audio controls loop?> + repeat toggle
```

The page keeps `?passage=` in `useSearchParams` so a lookup is a
shareable/bookmarkable URL — the finance convention for GET-form
state. No Bootstrap-JS-dependent widgets exist (no dropdowns,
modals, or offcanvas in this app), so nothing needs re-implementing
beyond what `shared/` already provides.

## Stages

Every merged stage deploys to prod; `/bible/` keeps serving the
template until the last stage. One PR per stage.

| Stage | Scope |
|---|---|
| 0. bible API | `bible_research/api.py`: `GET /verses/` (`auth=None`) + `POST /audio/`; `api.add_router('/bible/', …)` in `django_apps/urls.py`; sanitized 400/502 error mapping; **first real tests for this app** (`tests.py` is empty): mock `get_word.requests.get` — verse list parse, `raw` format passthrough, 'Passage not found', missing `passage` → 422, upstream non-200 → 502 with no `resp.text` leak, audio base64 round-trip, audio POST without session → 401, verses GET reachable unauthenticated, CSRF enforced on POST; export `openapi.json` |
| 1. SPA mount | `frontend/src/bible/` skeleton (`main.tsx`, `App.tsx`, `BibleNavBar`, `Passage` stub); Vite `input.bible`; `gen:types` third output; `/bible/app/` mount in `bible_research/urls.py`; bump `PWA_CACHE_VERSION` |
| 2. Passage page | `Passage.tsx`: passage input + `?passage=` search param, "Show text" (`useQuery` → `/api/bible/verses/`), "Play audio" (`usePassageAudio` → `/api/bible/audio/`), `VerseList`, `AudioPlayer` with repeat toggle, loading/error states from TanStack Query; Vitest/RTL tests (verse render, base64→blob URL, error state, not-found string). E2E: optional — a Playwright spec needs `ESV_KEY` and hits the real upstream, so a smoke test would have to mock at the Django layer; skip unless a clean seam exists |
| 3. Cutover | URL swap above; `/bible/app/*` → 301; `basename` → `'/bible'`; delete `templates/bible_research/`, `forms.py`, and the `generate_audio` view — **keep `views.verses` + `get_word.py` + `serializers.py`** (the public endpoint and the service the API reuses); point `bible_research:generate_audio` name at the shell; update root `AGENTS.md` repo map; bump `PWA_CACHE_VERSION` |

## Risks / gotchas

- **`/bible/verses` must stay public and routed forever.** It is
  consumed cross-origin by `reactive-bible.vercel.app`
  (`CORS_ALLOWED_ORIGINS`, security-audit F8). Session auth is
  impossible for that consumer (`SameSite=Lax`, no
  `credentials: 'include'`); never add `@login_required` to it and
  never let the cutover catch-all shadow it — keep
  `path('bible/verses', …)` **before** `bible/<path:subpath>`.
- **`auth=None` on the ninja op is deliberate**, not a copy-paste
  bug: it mirrors the legacy endpoint's public contract and gives
  reactive-bible a typed migration target. The audio POST keeps
  default `django_auth` — only the SPA page consumes it.
- **Check whether reactive-bible uses audio before Stage 3.** The
  legacy `POST /bible/` is unauthenticated today; post-cutover it
  404s. If the external app POSTs audio too, keep a public POST
  audio route (either the view or `auth=None` on the op) instead
  of deleting it.
- **Root-mount ordering.** `bible_research` is included under
  `path('')` second-to-last in `django_apps/urls.py` (only
  `path('', views.home)` follows). The catch-all must be
  `bible/<path:subpath>` inside the app's own urls — never a bare
  `<path:subpath>` at root, which would shadow `google_api`,
  `single_pages`, and `tv_archive` routes mounted earlier/later.
- **Upstream errors must not leak.** `get_verses` raises
  `Exception(f'API resp: {status} {resp.text}')`; the current view
  returns `str(e)` raw (F12). API ops map to 502/400 with a generic
  detail; keep 'Passage not found' user-meaningful.
- **`get_verses` has no `requests` timeout** — an upstream hang
  holds a gunicorn worker / Vercel lambda. Optional one-line
  hardening (`timeout=30`) in Stage 0; unchanged behavior
  otherwise.
- **Union response shape.** `verses` is `list | dict | str`
  depending on format/found — typed as `Union` (→ `oneOf` in
  OpenAPI) so the wire stays identical to `/bible/verses`; the SPA
  only uses the `json` (list) arm.
- **Page becomes login-required.** Deliberate (see Decision §3);
  the template is currently reachable anonymously. Login bounce is
  the standard `/admin/login/?next=` flow via `react_app`.
- **Both UIs write nothing.** Unlike finance there is no shared-DB
  mutation concern during the strangler — the app is stateless;
  both UIs only proxy ESV.
- **SW/PWA is already correct**: `/api/` is in `BYPASS_PATHS`
  (API responses never SW-cached); `/bible/app` navigations are
  network-first like every other page; `/bible/verses` fetches are
  neither navigations nor static assets so the SW passes them
  through untouched.

## Verification checklist (per stage)

```bash
source venv/bin/activate
python manage.py check
python manage.py test bible_research
npm run typecheck --prefix frontend && npm run lint --prefix frontend
python manage.py export_openapi_schema --api django_apps.api.api \
  > frontend/openapi.json && npm run gen:types --prefix frontend
  # → git diff must be empty for committed artifacts
```

Manual UI checks:

- Stage 1: `/bible/app/` renders the shell + stub route; `/bible/`
  still shows the template page and generates audio.
- Stage 2: same passage through `/bible/` (template) and
  `/bible/app/` (SPA) — same verses, audio plays in both, repeat
  toggle works, `?passage=` survives a refresh/share;
  `curl '/bible/verses?passage=John+3:16'` still answers JSON
  **without** a session cookie.
- Stage 3: `/bible/` serves the SPA; `/bible/app/` 301s to `/bible/`;
  `curl -X POST /bible/` → 404; `/bible/verses` unchanged;
  `home.html` "Bible Audio" card still resolves.
