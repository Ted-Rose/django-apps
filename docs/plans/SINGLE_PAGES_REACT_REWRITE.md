# single_pages React Rewrite — third app on the shared platform

> **Status**: ✅ Implemented (all stages merged at once — landed
> straight at the post-cutover state). The platform built for google_tasks
> (`frontend/` workspace, `django_apps/api.py` NinjaAPI,
> `spa_shell`/`react_app`/`app_redirect` in `django_apps/views.py`,
> django-vite, generated types, TanStack Query,
> `shared/` client/NavBar/Modal/Dropdown/Toasts) is live and
> deploy-verified — see `GOOGLE_TASKS_REACT_REWRITE.md`; finance is
> mid-strangler on it (`FINANCE_REACT_REWRITE.md`). This rewrite adds
> a third Vite entry; **no Docker, Vercel, CI, or settings changes
> are needed**.

## Decision

Convert `single_pages` to a React SPA the way `finance` was — **one
Vite entry** (`frontend/src/single_pages/`) with client-side routes,
exactly like finance has multiple routes in one entry. This is a
much smaller scope than finance: two GET-only pages, no models, no
mutations, no static files, ~330 LOC total.

- `single_pages/api.py` — a django-ninja `Router` mounted on the
  shared `NinjaAPI` as `/api/single_pages/` (`api.add_router(
  '/single_pages/', sp_router)` in `django_apps/urls.py`).
- `frontend/src/single_pages/` — new Vite entry reusing
  `frontend/src/shared/` wholesale.
- Same strangler pattern, adapted for the **root mount** (see
  below): the SPA stages under `/app/` (`/app/twister`,
  `/app/spoki`), then the cutover mounts the shell on the two
  existing page paths and 301s `/app/*` → `/*`.

### Per-page verdicts (honest assessment)

| Page | Today | Verdict |
|---|---|---|
| `/twister` (`views.twister`, `twister.html`, 283 lines) | Standalone HTML doc, all logic client-side (inline JS); only server dependency is `GET /text-to-audio` (google_api) for Latvian TTS | **Convert** — the flagship toy, linked from `home.html`. It's effectively already an SPA; React gives real state management for the 4 editable string lists + game loop. Zero new backend needed for game logic. |
| `/spoki/` (`views.spoki_page_view`, `blog_proxy_template.html`, 26 lines) | `random.choice` over 9 hardcoded spoki.lv URLs → `requests.get` with fake UA → `str(soup)` dumped via `\|safe` | **Convert, but only as an API + thin route — and it's the droppable scope.** The proxy fetch must stay server-side (JS can't fetch cross-origin and shouldn't). The page is also half-broken today: the view passes `title`/`content` but the template reads `page_title`/`error`/`EXTERNAL_BLOG_URI`, and the template is a block fragment with no `{% extends %}` — it "works" only because the dumped full-page HTML renders anyway. Converting means `GET /api/single_pages/spoki/` → `{title, html}` with **nh3 sanitization**, which fixes security finding F4 (scraped HTML rendered `\|safe` = XSS). If it's judged not worth keeping, delete the view + template instead — the rest of the plan is unaffected either way. |

### Structural difference: root-mounted app

`single_pages` mounts at **root** via
`path('', include('single_pages.urls'))` — its URLs are `/twister`
and `/spoki/`, not `/single_pages/*`. Consequences vs. finance:

- **No `/single_pages/` prefix exists to claim.** The tasks/finance
  strangler mounted the SPA at `/<app>/app/`; here the mount is
  `path('app/…')` inside `single_pages/urls.py`, i.e. **`/app/` at
  site root** (verified free — no other root-mounted app uses an
  `app/` prefix).
- **Never add a `<path:subpath>` catch-all at root level.**
  `single_pages.urls` is included *before* `tv_archive`
  (`/tv-arhivs`), `bible_research` (`/bible/…`) and `views.home` — a
  root catch-all would shadow all of them. The only catch-all ever
  allowed is under the staging prefix (`app/<path:subpath>`), and
  it's removed at cutover.
- **`BrowserRouter basename` swaps `/app` → nothing** (omit the prop
  at cutover). Django — not React Router — decides which URLs serve
  the shell: only the explicit `twister` and `spoki/` routes do, so
  basename-less absolute routes `/twister`, `/spoki` are safe.
- **Auth becomes stricter.** Both pages are public today; `react_app`
  → `spa_shell` is `@login_required` and ninja's `django_auth` covers
  `/api/single_pages/*`. Anonymous visitors clicking the Twister card
  on `home.html` will bounce to `/login/` (Google OAuth). This is a
  deliberate hardening — security finding F3 wants `/text-to-audio`
  authenticated anyway, and that endpoint is twister's only data
  dependency — but it is a behavior change; keep it documented.

Django remains the backend: session auth, the spoki.lv proxy fetch,
and `google_api.utils.text_to_audio` — all unchanged.

## Current frontend surface (what's being replaced)

### Templates (~310 lines under `single_pages/templates/`)

| Template | Lines | Becomes |
|---|---|---|
| `twister.html` | 283 | route `/twister` — standalone doc: 4 dynamic string-list forms (players, body parts, animals, colors) + interval + pause checkbox; on "Spēlēt!" it prefetches a TTS `<audio>` per field value and loops random player×part×animal×color announcements |
| `blog_proxy_template.html` | 26 | route `/spoki` — fetch `/api/single_pages/spoki/`, render sanitized `html` server-side output |

### JS (~120 lines, all inline in `twister.html`)

| Block | React equivalent |
|---|---|
| `addField` / `removeEmptyFields` | `<FieldList>` component — controlled `string[]` state |
| `createAudio` (fetch `/text-to-audio`, append `<audio>` per field) | `useTwisterAudio` hook — `GET /api/single_pages/tts/` results cached by `hashOf(text)` in a `Map`, prefetched on game start |
| `playAudios` (await `onended` sequentially) | same hook — `new Audio(url)` + `await` on `ended` |
| `playGame` (recursive `setTimeout` loop, pause checkbox) | `useEffect`-driven game loop in `Twister.tsx` — picks random items, `playSequence`, schedules next move unless paused |
| `hashOf` (djb2-ish string hash) | `utils.ts` unchanged — the hash is also the GCS `filename`, so the same text reuses the same server-side audio object |
| inline `<style>` (~60 lines) | `twister.css` imported into the entry |

### Backend surface

- **Read views → GET endpoints** (2):
  - `spoki_page_view` → `GET /api/single_pages/spoki/` — keep the
    `requests.get` + BeautifulSoup fetch in `views.py` (or a small
    `services.py`); the ninja op calls it and adds `nh3.clean`.
  - twister needs no data endpoint — its only call is audio.
- **Audio** → `GET /api/single_pages/tts/` delegating to
  `google_api.utils.text_to_audio(text, lang, filename)` — the typed,
  session-authenticated replacement for twister's current
  `/text-to-audio` calls (that legacy endpoint stays untouched for
  `gmail.html` until google_api gets its own rewrite).
- **Mutations: none.** The app has no POSTs — CSRF is moot for the
  API surface (all GETs); `django_auth` still supplies the session
  requirement.

## API contract (`single_pages/api.py`, mounted at `/api/single_pages/`)

```
GET /api/single_pages/tts/?text=&lang=&filename=  → AudioOut
    wraps google_api.utils.text_to_audio; ValueError → 400,
    AudioGenerationError/other → 502
GET /api/single_pages/spoki/                       → SpokiOut
    random pick from the existing URL list, requests.get
    (fake UA kept), BeautifulSoup parse, nh3.clean on the article
    HTML; RequestException → 502 {error: 'upstream_error'}
```

### Schemas (Pydantic, source of the generated TS types)

```
AudioOut: audio_url: str                       # GCS signed URL (7d)
SpokiOut: title: str, html: str,               # html is nh3-sanitized
          source_url: str
```

`lang` validation reuses `text_to_audio`'s lv/en restriction — a
plain `str` param plus the util's own `ValueError` is enough; no
`Literal` needed unless the util's rules tighten.

Type generation — same workflow as tasks/finance:

```bash
python manage.py export_openapi_schema --api django_apps.api.api \
  > frontend/openapi.json
npm run gen:types --prefix frontend
```

`gen:types` grows a third output: `src/single_pages/api-types.ts`
(append one `openapi-typescript` command, or convert the script to a
loop over `[tasks, finance, single_pages]` — preferred, since a
fourth app is likely).

## URL & cutover design (`single_pages/urls.py`)

During staging (`app/` mount added, existing routes untouched):

```python
react_app_sp = partial(
    react_app, entry='single_pages', title='Pages'
)

urlpatterns = [
    path('app/', react_app_sp, name='spa_app'),
    path('app/<path:subpath>', react_app_sp, name='spa_app_subpath'),
    path('twister', views.twister, name='twister'),
    path('spoki/', views.spoki_page_view, name='spoki_page'),
]
```

At cutover the shell takes over the page paths — keep **both names**
(`home.html` reverses `single_pages:twister`):

```python
app_redirect_root = partial(app_redirect, base='')

urlpatterns = [
    path('twister', react_app_sp, name='twister'),
    path('spoki/', react_app_sp, name='spoki_page'),
    # legacy strangler mount → 301 /app/<sub> → /<sub>
    path('app', app_redirect_root, name='react_app_noslash'),
    path('app/', app_redirect_root, name='react_app'),
    path('app/<path:subpath>', app_redirect_root,
         name='react_app_subpath'),
]
```

**`app_redirect` needs a one-line generalization** —
`f"/{base.strip('/')}/"` produces `'//'` for a root mount, which the
browser reads as a protocol-relative URL. Fix:
`prefix = f"/{base.strip('/')}/" if base.strip('/') else '/'`.

Non-GET/HEAD requests under the page paths 404 in `react_app`
post-cutover — nothing legit POSTs there today.

**No root catch-all, ever** — see Decision. If spoki is dropped
entirely, omit its route and its API op; everything else stands.

## Frontend layout

```
frontend/src/single_pages/
  main.tsx            # createRoot + BrowserRouter basename='/app'
                      #   (prop removed at cutover)
  App.tsx             # Routes: /twister, /spoki; * → Navigate /twister
  api-types.ts        # generated — do not edit
  api.ts              # typed fetchers over shared/api/client.ts
  twister.css         # ported inline styles
  utils.ts            # hashOf
  routes/
    Twister.tsx       # form + game loop
    Spoki.tsx         # sanitized-HTML render
  components/
    FieldList.tsx     # labeled dynamic string-list inputs
    useTwisterAudio.ts# prefetch + sequential playback
```

No NavBar/BurgerMenu — both pages are standalone full-screen toys
today; keep a minimal "← home" link instead. Twister keeps its own
look (`twister.css`), not Bootstrap cards; `spa_shell.html` needs no
changes (Bootstrap CDN + `pwa/head.html` already included, so the
pages stay installable/offline-cached like before). Spoki renders
`dangerouslySetInnerHTML` — safe *because* the server sanitizes with
nh3; never render raw upstream HTML.

## Stages

Every merged stage deploys to prod; `/twister` + `/spoki/` keep
serving templates until the last stage. One PR per stage. Whole
scope is days, not weeks — stages may be merged pairwise.

| Stage | Scope |
|---|---|
| 0. API | `single_pages/api.py` (tts + spoki ops + schemas); `api.add_router('/single_pages/', …)`; `nh3` added to `requirements.txt`; `app_redirect` `base=''` fix + `SPA_BASES` entry in `spa_url_for`; Django tests in the (currently empty) `tests.py`: unauthenticated → 401 JSON, tts `ValueError` → 400, upstream failure → 502, spoki response is sanitized (no `<script>`/`on*=` attrs), `source_url` in known list; export `openapi.json` |
| 1. SPA mount | `frontend/src/single_pages/` skeleton (main/App/routes as stubs); Vite `input.single_pages`; `gen:types` third output (or entry loop); `app/` + `app/<path:subpath>` routes in `single_pages/urls.py`; bump `PWA_CACHE_VERSION` |
| 2. Twister | `<FieldList>` ×4, interval + pause controls, `useTwisterAudio` (prefetch on "Spēlēt!", `Map` cache by `hashOf`, sequential `Audio` playback), recursive-move game loop; parity check: same default field values, same pause semantics |
| 3. Spoki + tests | `Spoki.tsx` (loading/error/empty states, sanitized HTML render, source link); Vitest/RTL for `FieldList` + audio cache; Playwright `single_pages.smoke.spec.ts` (load `/app/twister`, click Spēlēt! with a mocked tts endpoint, load `/app/spoki` with a mocked API response) |
| 4. Cutover | URL swap above (`basename` prop removed); `/app/*` → 301; delete `single_pages/templates/` and the two views (keep the spoki fetch helper if `api.py` uses it); update root `AGENTS.md` + `single_pages/README.MD`; bump `PWA_CACHE_VERSION` |

## Risks / gotchas

- **Root mount ordering.** `single_pages.urls` is included before
  `tv_archive`, `bible_research` and `home` in
  `django_apps/urls.py`. The `app/<path:subpath>` staging catch-all
  only matches `/app/*` — verify no existing URL starts with `app/`
  (checked: none). Never add a bare `<path:subpath>` at root.
- **`app_redirect(base='')` is currently broken** (`'//'` prefix →
  protocol-relative redirect). Fix in Stage 0 with a test.
- **`spa_url_for` assumes `/<app>/` mounts.** A 401 on
  `/api/single_pages/spoki/` would produce `next=/single_pages/spoki/`
  → 404 after login. The fix is the `SPA_BASES` map in
  `django_apps/api.py` (API-prefix → SPA base; mapped apps collapse
  the API subpath to the base and keep only the query) — the same
  mechanism the google_api plan specifies, so whichever root-mount
  Stage 0 lands first introduces `SPA_BASES` and the other adds its
  entry. For this app: `SPA_BASES['single_pages'] = '/twister'`
  (the primary page; `/` = home also works).
- **Auth tightening is intentional but visible.** Both pages go
  public → login-required. `home.html` is itself public, so an
  anonymous click on the Twister card now bounces to OAuth —
  acceptable for a personal tools site and required for the tts
  hardening (F3), but call it out in the PR body.
- **F4 must not survive the port.** `dangerouslySetInnerHTML` is
  only acceptable because `nh3.clean` runs server-side; add a test
  asserting `<script>`/`onerror=` are stripped. `nh3` is the
  maintained bleach successor (bleach is deprecated upstream).
- **TTS cost.** `text_to_audio` synthesizes+uploads to GCS on every
  *miss*; twister prefetches one call per field value per game. The
  `filename` hash means repeat phrases reuse the same GCS object —
  keep `hashOf` byte-identical so cache hits persist.
- **Vercel lambda timeout / cold external fetch.** `spoki` does a
  live `requests.get` per hit, same as today — unchanged risk; add a
  sane `timeout=` (there is none today) while porting.
- **Changelog wishes for `/text-to-audio`** ("text as body", "check
  if exists") apply to the legacy endpoint; the new `tts` op is GET
  for parity — record the improvement ideas against the api op so
  google_api's rewrite can adopt them.
- **No catch-all at cutover.** `/twister/foo` and `/spoki/x/` will
  404 — intentional; no client-side sub-routes exist. If pages ever
  grow sub-routes, add a catch-all *per page path*
  (`twister/<path:subpath>`), never at root.
- **`spoki` template bugs die with the template** — `page_title`,
  `error`, `EXTERNAL_BLOG_URI` mismatches are replaced by the typed
  `SpokiOut`; no need to fix the template first.
- **Both UIs live between stages 1–4**: `/twister` template and
  `/app/twister` SPA coexist; identical because the SPA shares the
  same `text_to_audio` backend and the game logic is pure client.

## Verification checklist (per stage)

```bash
source venv/bin/activate
python manage.py check
python manage.py test single_pages
npm run typecheck --prefix frontend && npm run lint --prefix frontend
python manage.py export_openapi_schema --api django_apps.api.api \
  > frontend/openapi.json && npm run gen:types --prefix frontend
  # → git diff must be empty for committed artifacts
```

Manual UI checks per stage: compare `/twister` (template) against
`/app/twister` (SPA) — same defaults, game announces moves, pause
stops scheduling; load `/spoki/` vs `/app/spoki` — title + article
render, no console errors, view-source shows no `<script>` from
upstream content. After cutover: `/app/twister` 301s to `/twister`,
`{% url 'single_pages:twister' %}` on `/` still resolves.
