# TV Archive React Rewrite — third app on the shared platform

> **Status**: ✅ Implemented — all four stages landed; the SPA
> serves `/tv-arhivs` (template deleted) and `/tv-arhivs/app/*`
> 301s. The platform (`frontend/` workspace,
> `django_apps/api.py` NinjaAPI, `spa_shell`/`react_app`/
> `app_redirect`/`react_app_public`, django-vite, generated types,
> TanStack Query,
> `shared/` client/NavBar/Modal/Dropdown/Toasts) is live —
> `google_tasks` and `finance` are fully cut over (see
> `GOOGLE_TASKS_REACT_REWRITE.md`,
> `FINANCE_REACT_REWRITE.md`). This rewrite adds a third Vite
> entry; **no Docker, Vercel, CI, or settings changes are needed**.

## Decision

Rewrite `tv_archive` as a React SPA exactly the way `finance` was:

- `tv_archive/api.py` — a django-ninja `Router` mounted on the
  existing `NinjaAPI` as `/api/tv-arhivs/`
  (`api.add_router('/tv-arhivs/', tv_archive_router)` in
  `django_apps/urls.py`). The API path follows the app's public
  mount name, like `/api/tasks/` ↔ `/tasks/` — not the Python
  package name. One OpenAPI spec; types regenerate into
  `frontend/src/tv_archive/api-types.ts`.
- `frontend/src/tv_archive/` — new Vite entry
  (`main.tsx`, `BrowserRouter basename='/tv-arhivs'`), reusing
  `frontend/src/shared/` wholesale.
- Same strangler mount: the SPA lives at **`/tv-arhivs/app/`**
  while the template keeps serving `/tv-arhivs`; the final stage
  swaps them and 301s `/tv-arhivs/app/*` → `/tv-arhivs/*`.

Django remains the backend: the `Content` model, the
tet.lv/IMDb/googletrans scraper, the `tv_archive` logger config in
settings — all unchanged.

### Structural differences from finance/tasks

1. **The page is public today.** `content_list` has no
   `@login_required` (same as `single_pages` and
   `bible_research`), and `home.html` links to it for everyone.
   The rewrite keeps it public — gating it behind login is a
   product decision, not part of the rewrite (the security audit
   F9 also lists auth as optional for this page). Concretely:
   - API: `auth=None` on the router's operation — with
     django-ninja 1.7, `auth=None` empties `auth_callbacks`
     (only `NOT_SET` inherits the API-level `django_auth`;
     verified in `ninja/operation.py::_set_auth`). Cover with a
     test: anonymous GET → 200.
   - Shell: `spa_shell`/`react_app` are `@login_required`. Stage
     1 extracts their bodies into undecorated
     `_spa_shell`/`_react_app`; `spa_shell`/`react_app` stay the
     login-required wrappers (tasks/finance mounts unchanged) and
     a new `react_app_public` serves tv_archive.
   - CSRF: irrelevant — the API is GET-only.
2. **The rewrite is read-only** — zero mutations, no forms, no
   `messages`, no CSRF surface. The strangler guarantee ("same
   mutation semantics from both UIs") is vacuous here; the only
   parity risk is *reads* — same rows under the same filters.
3. **The scraper is not a view.** `fetch_tv_program_details()`,
   `get_ratings`, `random_sleep` and the urllib3 pool sit in
   `views.py` but are wired to **no** URL — they run manually via
   `manage.py shell` (documented in root `AGENTS.md`). The
   rewrite keeps them manual: Stage 0 moves them to
   `tv_archive/scraper.py` and adds a thin
   `management/commands/fetch_tv_programs.py` so the invocation
   becomes `python manage.py fetch_tv_programs` (the
   `sync_bank_transactions` convention). **Not** exposed as an
   endpoint — a run sleeps 1–2 s per program across ~14 days ×
   3 channels plus per-program IMDb detail fetches and googletrans
   calls: minutes-to-hours, far past any request budget.
4. **No external calls on the request path.** `content_list` is a
   pure ORM read — tet.lv scraping, IMDb lookups and
   `translate_lv_to_eng` (googletrans, unofficial/brittle per
   `AGENTS.md`) all live in the manual scraper. The API is one
   fat GET per the Vercel `max_connections` lesson: page of
   results + filter-option lists in a single response, never
   per-card or per-dropdown calls.

## Current frontend surface (what's being replaced)

### Templates (137 lines, one file, flat — not namespaced)

| Template | Lines | Becomes |
|---|---|---|
| `content_list.html` | 137 | route `/` under basename `/tv-arhivs` — feed cards + GET filter form; its ~70 lines of inline `<style>` port to `tv_archive.css` imported by the entry |

### JS / static — none

No `static/` dir, no JS files, no CSRF token usage. The filter
form is a plain GET submit; everything becomes React state +
`useSearchParams`.

### Backend surface

- **Read view → GET endpoint** (1): `content_list` filters
  `Content` by 8 GET params and renders *every* match — no
  pagination, no `order_by` (arbitrary DB order). The endpoint
  adds explicit ordering (`-start_date`, `-id` — required for
  stable pages) and `Paginator`. Filter-option lists (distinct
  `channel`, `content_rating`, `type` values) ride in the same
  response so dropdowns need no second call.
- **Mutations:** none — the app never writes from the web.
- **`fetch_tv_program_details()`:** stays manual-only, moves to
  `scraper.py` + management command (above); the rewrite does not
  wire it to a URL or API.
- **External callers of the URL name:** `home.html`
  `{% url 'tv_archive:tv-arhivs' %}` — keep the name on the SPA
  route at cutover so the home card never changes.
- **Security note:** F9 in `SECURITY_AUDIT_FIXES.md` — junk in
  `rating_value`/`ratio`/`start_date` raises `ValidationError` →
  500 today. Ninja query schemas fix it for free (422), no `Form`
  needed.

## API contract (`tv_archive/api.py`, mounted at `/api/tv-arhivs/`)

```
GET /api/tv-arhivs/contents/    → ContentsOut      (auth=None)
    ?content_rating=&not_content_rating=&rating_value=
    &start_date=&end_date=&ratio=&channel=&not_channel=&page=
```

Param names mirror the template's GET form so strangler-period
comparison is literal (`/tv-arhivs?channel=ltv1_hd` vs the same
params on `/api/`). Typed params do the validation —
`rating_value`/`ratio` floats, `start_date`/`end_date` ISO dates —
so garbage returns 422 instead of today's 500. Two deliberate
semantic changes, both flagged:

- `ratio` becomes `ratio__gte` (minimum LV↔EN match score).
  Exact float equality on a computed 0–1 ratio almost never
  matches — "minimum" is what the filter was meant to be.
- Results are paginated (`page_size=50`) with a fixed ordering;
  the template showed all rows in arbitrary order.

### Schemas (Pydantic, source of the generated TS types)

```
ContentOut:  id, title_lv, title_eng, type,
             description_lv|null, description_eng|null,
             image|null, url, content_rating|null,
             rating_value|null, start_date|null,   # ISO date
             channel, ratio|null
ContentsOut: contents: ContentOut[], page, num_pages, count,
             channels: str[], content_ratings: str[],
             types: str[]       # distinct values → dropdowns
```

`Content` is global data (no user FK) — no `for_user()` scoping
needed, unlike every other app on the platform.

Type generation — same workflow, one more output:

```bash
python manage.py export_openapi_schema --api django_apps.api.api \
  > frontend/openapi.json
npm run gen:types --prefix frontend
# gen:types gains a third openapi-typescript call emitting
# src/tv_archive/api-types.ts from the same committed spec
```

## URL & cutover design (`tv_archive/urls.py`)

The app mounts at the site root (`django_apps/urls.py`,
`path('', include('tv_archive.urls'))`); its page URLs are the
literal `tv-arhivs*` prefix, which collides with nothing else at
root (`twister`, `spoki/`, `bible/`, google_api paths).

During staging:

```python
react_app_tv = partial(
    react_app_public, entry='tv_archive', title='TV Archive'
)

urlpatterns = [
    path('tv-arhivs/app', react_app_tv, name='spa_app'),
    path('tv-arhivs/app/', react_app_tv),
    path('tv-arhivs/app/<path:subpath>', react_app_tv),
    path('tv-arhivs', views.content_list, name='tv-arhivs'),
]
```

At cutover the SPA takes over `tv-arhivs*`; `home.html` keeps
working because the `tv-arhivs` name stays alive:

```python
react_app_tv = partial(
    react_app_public, entry='tv_archive', title='TV Archive'
)
app_redirect_tv = partial(app_redirect, base='/tv-arhivs/')

urlpatterns = [
    path('tv-arhivs', react_app_tv, name='tv-arhivs'),
    path('tv-arhivs/', react_app_tv),            # 404s today;
                                                # cheap to add
    path('tv-arhivs/app', app_redirect_tv),
    path('tv-arhivs/app/', app_redirect_tv),
    path('tv-arhivs/app/<path:subpath>', app_redirect_tv),
    # catch-all LAST — it would otherwise swallow tv-arhivs/app*
    path('tv-arhivs/<path:subpath>', react_app_tv,
         name='spa_subpath'),
]
```

`react_app` semantics carry over: GET/HEAD render the shell,
everything else 404s (vacuous here — there were never POST URLs
under `tv-arhivs`). `app_redirect` is deliberately not
`login_required`, so it serves the public page correctly too.

## Frontend layout

```
frontend/src/tv_archive/
  main.tsx            # createRoot + BrowserRouter basename:
                      #   '/tv-arhivs/app' during staging,
                      #   '/tv-arhivs' post-cutover (same flip
                      #   finance does /finance/app → /finance)
  App.tsx             # Routes: / → Feed; * → Navigate to /
  api-types.ts        # generated — do not edit
  api.ts              # typed fetcher over shared/api/client.ts
  tv_archive.css      # ported from content_list.html <style>
  routes/
    Feed.tsx          # filter bar → useSearchParams, card feed,
                      # pagination, empty/loading/error states
  components/
    FilterBar.tsx     # inputs mirroring the GET form; channel /
                      #   content_rating / type become <select>s
                      #   fed by the response option lists
    ContentCard.tsx   # image + LV title/desc + rating, channel,
                      #   date, ratio metadata row
    Pagination.tsx
```

All filter state lives in the query string — filterable views stay
shareable/bookmarkable, and a copied `/tv-arhivs?…` URL works
verbatim in the SPA (same param names).

Nav: the template page has **no** navbar, so don't force
`<NavBar>` — a slim header (title + link back to `/`) suffices.
If `<NavBar>` is reused later, remember the page is public: the
bootstrap payload's `user` is `''` for anonymous visitors.

## Stages

Every merged stage deploys to prod; `/tv-arhivs` keeps serving the
template until the last stage. One PR per stage.

| Stage | Scope |
|---|---|
| 0. API + scraper move | `tv_archive/api.py` router + `ContentOut`/`ContentsOut` schemas; `api.add_router('/tv-arhivs/', …)`; move `fetch_tv_program_details`/`get_ratings`/`random_sleep`/urllib3 pool to `tv_archive/scraper.py`; add `management/commands/fetch_tv_programs.py`; explicit `.order_by('-start_date', '-id')` + `Paginator`; tests: anonymous GET → 200 (the `auth=None` contract), 422 on bad float/date params, pagination shape, each filter's semantics, option lists, ordering determinism; export `openapi.json` |
| 1. SPA mount | `django_apps/views.py`: extract `_spa_shell`/`_react_app`, keep `spa_shell`/`react_app` login-required, add `react_app_public`; `frontend/src/tv_archive/` skeleton (main/App/Feed stub); Vite `input.tv_archive`; `gen:types` third output; `/tv-arhivs/app*` mount above; bump `PWA_CACHE_VERSION` |
| 2. Content feed | Feed route: FilterBar (all 8 params), card feed, pagination, empty/loading/error states, image fallback (keep `via.placeholder.com` or swap for a CSS placeholder — decide once); Vitest/RTL tests for filter→search-params mapping + card rendering; Playwright `tv_archive.smoke.spec.ts` (load `/tv-arhivs/app/`, apply a filter, change page) |
| 3. Cutover | URL swap above; `/tv-arhivs/app*` → 301; basename flip to `/tv-arhivs`; delete `tv_archive/templates/`, `content_list` and the now-empty `views.py`; `home.html` untouched (name preserved); update root `AGENTS.md` (tv_archive row + "SPA like tasks/finance" note) and add `tv_archive/AGENTS.md` if useful; bump `PWA_CACHE_VERSION` |

## Risks / gotchas

- **`auth=None` must be tested, not assumed** — it's the first
  public operation on the shared NinjaAPI. The Stage 0 anonymous-
  GET test is the contract; if a ninja upgrade ever changes the
  `None` vs `NOT_SET` handling, that test is the tripwire.
- **Public shell is new platform surface.** `_spa_shell`'s
  `bootstrap.user` comes from `request.user.get_username()` →
  `''` for AnonymousUser — fine today; any future bootstrap field
  must not assume a logged-in user. `react_app` keeps its
  non-GET/HEAD → 404 rule.
- **Pagination changes the read contract.** The template renders
  every match (potentially thousands of rows); the API pages at
  50. `count` preserves the total; the UI gains page controls.
- **`start_date`/`end_date` both filter `start_date`** (`__gte`/
  `__lte` respectively) — keep the quirk verbatim; it reads as
  "date range on the air date".
- **Ordering was arbitrary.** `-start_date, -id` is a deliberate,
  mild improvement — the template's row order was effectively
  random; nobody could depend on it.
- **`ratio` semantics flip** (`=` → `__gte`) — deliberate, called
  out in the API section; label the input "Min ratio" in the SPA.
- **`Content.url` (the IMDb URL) is the `update_or_create` key**
  in the scraper, so the same film on another channel/day
  collapses into one row — `channel`/`start_date` are
  last-write-wins. Pre-existing behavior; explains surprising
  `count`s when eyeballing the feed. Not a rewrite issue.
- **googletrans brittleness** (`AGENTS.md` gotcha) stays confined
  to the manual scraper — the rewrite neither fixes nor worsens
  it; document `fetch_tv_programs` as "may break upstream" in the
  command's help text.
- **Catch-all ordering** — at cutover the `tv-arhivs/app*`
  redirect patterns must precede `tv-arhivs/<path:subpath>` or
  `/tv-arhivs/app` serves the SPA forever instead of 301ing.
- **`via.placeholder.com` fallback** is a third-party dependency
  baked into the template; a CSS/local placeholder removes it —
  decide in Stage 2, don't carry it forward blindly.
- **`image`/`description_*` are nullable** — cards must render
  without them (`{% empty %}`/`|default` behavior parity).
- **No test-suite drag.** `tv_archive/tests.py` is empty — unlike
  finance there is no view-test suite to port; Stage 0 writes
  fresh API tests.
- **Both UIs read the same table** during staging — trivially
  safe since there are no writes.

## Verification checklist (per stage)

```bash
source venv/bin/activate
python manage.py check
python manage.py test tv_archive
npm run typecheck --prefix frontend && npm run lint --prefix frontend
python manage.py export_openapi_schema --api django_apps.api.api \
  > frontend/openapi.json && npm run gen:types --prefix frontend
  # → git diff must be empty for committed artifacts
```

Manual UI checks per stage: compare `/tv-arhivs?<filters>`
(template) against `/tv-arhivs/app/?<filters>` (SPA) on the same
data — same rows, same `count`; load both **in incognito** to
prove the anonymous path works end to end (public shell, public
API, no login bounce).
