# django_apps React Rewrite — project package on the shared platform

> **Status**: 📋 Plan. `django_apps` is the **project** package, not
> an app: it owns the home page, the PWA plumbing, `spa_shell`
> itself, the shared `NinjaAPI`, and small server-side utilities.
> Most of it is infrastructure the React platform is *built on*, so
> the honest scope is much smaller than an app rewrite — see the
> decision below. Platform facts and conventions come from
> `GOOGLE_TASKS_REACT_REWRITE.md` (done) and
> `FINANCE_REACT_REWRITE.md` (in progress).

## Decision: keep the home page a Django template — revisit last

**Do not write a `home` Vite entry now.** The home page
(`views.home` → `templates/home.html`, ~177 lines) is a static
directory of six tool cards. Unlike every app rewrite, the React
platform buys it nothing:

- **No server state.** There is no data to fetch, no mutation, no
  client-side routing — TanStack Query, React Router, and generated
  types would all be dead weight. A React version would ship a JS
  bundle to render what is today one static HTML file.
- **It's public; `spa_shell` is not.** `home` has no
  `@login_required` — it's the landing page anonymous visitors (and
  the PWA install flow) hit first. `spa_shell` forces login, so a
  React home would need a *new public shell variant* — new infra
  built for zero functional gain, plus a UX regression (bouncing
  logged-out visitors to `/admin/login/` just to see the directory).
- **It's the hub that must survive every strangler phase.** The
  cards link via `{% url %}` names (`finance:accounts`,
  `google_tasks:dashboard`, `tv_archive:tv-arhivs`, …) that stay
  valid whether the target app serves templates or an SPA — the
  per-app cutovers deliberately keep URL names alive for exactly
  this reason. A React home would hardcode paths that must be
  re-touched at every app's Stage 6; the template never needs to
  know which UI is live.
- **It's the PWA entry point.** `/` is `start_url` in the manifest
  and first in `PRECACHE_URLS` — a plain HTML page is the fastest,
  most reliable thing to precache and serve offline. A React shell
  that precaches as "Loading React app…" before its bundle is cached
  is strictly worse.
- **Cost of keeping it is ~zero.** The inline navbar duplicates the
  shared React `NavBar` look already, so visual drift is the only
  maintenance cost — acceptable at this size.

### Revisit trigger (the only React shape that would make sense)

Reconsider only **after the last template-based app is cut over**
(or if home ever grows real interactivity — search, per-app status
badges, etc.). If it happens, the right shape is a **thin `home`
Vite entry with no React Router** (one screen, no routes) rendered
by a new *public* shell variant of `spa_shell` (drop
`@login_required`, keep `ensure_csrf_cookie`, bootstrap without
`user`), mounted at `/` with the same `BrowserRouter basename='/'`
-free pattern — i.e. `createRoot` straight onto a component tree.
The card list could then come from the `bootstrap` json_script or a
`GET /api/main/links/` endpoint. Until then this is speculative —
don't build it.

## Surface table

| Surface | File(s) | Decision |
|---|---|---|
| Home page | `views.home`, `templates/home.html` | **Keep as Django template** (decision above) |
| Service worker endpoint | `views.service_worker`, `templates/pwa/sw.js` | **Keep** — must stay a Django-rendered URL |
| Manifest endpoint | `views.manifest`, `templates/pwa/manifest.webmanifest` | **Keep** — same |
| Offline page | `views.offline`, `templates/pwa/offline.html` | **Keep** — same |
| PWA head include | `templates/pwa/head.html` | **Keep** — shared by home/offline/spa_shell |
| SPA shell + helpers | `spa_shell`, `react_app`, `app_redirect`, `templates/spa_shell.html` | **Keep, shared infra** — see below |
| Shared NinjaAPI | `django_apps/api.py` | **Keep** — apps register routers on it; unchanged |
| Burger menu template | `templates/components/burger_menu.html` | **Keep** while any template app remains; React twin already exists (`shared/components/BurgerMenu.tsx`); deleted with the last app cutover |
| LV→EN translate | `utils.translate_lv_to_eng` | **Keep server-side** — used only by `tv_archive` views during scraping; never browser-facing |
| Deploy/infra helpers | `settings.py`, `gcp.py`, `console_tasks/build.py`, `urls.py`, `wsgi/asgi.py` | **Out of scope** — untouched |

## What becomes an API endpoint

**Nothing, now.** `django_apps` deliberately has no app router of
its own — `django_apps/api.py` is the shared `NinjaAPI` instance,
auth contract, and exception handlers; routers live in the apps
(`api.add_router('/tasks/', …)`, `/finance/`). The only conceivable
future endpoint is translate (`POST /api/…/translate/`), and that
belongs in a **tv_archive router** if that app is ever rewritten —
do not invent a `/api/main/` router for it.

## PWA endpoints: out of SPA scope, permanently

`/sw.js`, `/manifest.webmanifest`, `/offline/` must stay
Django-served URL endpoints — they cannot be Vite assets:

- **Root scope.** The SW must be served from `/` (or with
  `Service-Worker-Allowed: /`, which `service_worker` sets) to
  control the whole site; an asset under `/static/` can't.
- **Rendered, not static.** `sw.js` is a template receiving
  `cache_version`/`offline_url`/`static_url` context and `{% static %}`
  icon URLs; the manifest uses `{% static %}` too. Serving them as
  files would break cache-version propagation.
- **Content types + cache headers** (`application/javascript`,
  `application/manifest+json`, `no_cache` on the SW, `max-age` on
  the manifest) are set in the views.

Interaction with SPA work stays as established: `BYPASS_PATHS`
already includes `/api`; bump `PWA_CACHE_VERSION` on every merged
stage that changes shipped frontend (already the convention).

## URL design

No new URLs. Two tiny hardening touches, optional:

- Name the root route `path('', views.home, name='home')` so it
  can be `reverse()`d instead of hardcoding `/`.
- Leave `path('', views.home)` **last** in `urlpatterns` — it is
  the catch-all for unmatched root paths; moving it up would
  shadow the root-mounted app includes.

Everything else — `/api/`, the PWA endpoints, the per-app includes —
is unchanged.

## Cross-cutting infra: what this plan needs from `spa_shell`

**Nothing right now** — and that is the point to record:
`django_apps/views.py` + `spa_shell.html` + `api.py` are shared by
*every* SPA mount (tasks today, finance next, any future app), so
the default for this package is **change nothing**. The finance
plan's suggestion to promote `react_app`/`app_redirect` to
`django_apps` is already done — they live here, generalized on
`entry`/`base`.

Rules for any future change to these files:

- Treat `spa_shell`, `react_app`, `app_redirect`, `spa_shell.html`,
  and the `api.py` exception handlers as **cross-cutting**: a change
  ships to all mounted apps at once and needs regression checks on
  each (`/tasks/*` today, `/finance/app/*` during staging).
- `spa_shell`'s bootstrap payload (`{'user': …}`) can grow keys
  (e.g. `burger_menu_items` — `useBootstrap` already types it)
  without breaking existing entries; removing/renaming `user` would.
- Smell worth fixing in passing, not blocking: `spa_url_for` in
  `api.py` special-cases the `dashboard` subpath (tasks-specific);
  keep it in mind if a third app's landing route isn't named
  `dashboard`.
- Incoming edits from the root-mount rewrites, all consistent with
  the change-nothing default: `spa_url_for` gains a `SPA_BASES`
  map (API-prefix → SPA base for apps whose public base isn't
  `/<api-prefix>/`; see the google_api/single_pages plans —
  whichever Stage 0 lands first introduces it), and `app_redirect`
  gains an empty-`base` guard (`base=''` currently emits `'//'`,
  a protocol-relative redirect — the single_pages plan's Stage 0
  owns it). A `react_app_public` variant (undecorated
  `_spa_shell`/`_react_app` split) arrives with the tv_archive
  plan's Stage 1.
- Test smell: `django_apps` has no `tests.py` — `spa_shell` tests
  live in `google_tasks/tests.py` (~line 679+). Acceptable while
  tasks is the only mature mount; move them to a
  `django_apps/tests.py` when a third app mounts.

## Stages

Deliberately minimal — one small PR, then nothing until the
revisit trigger fires.

| Stage | Scope |
|---|---|
| 0. Housekeeping (optional, tiny) | Name the home route `main:home`; add a `django_apps/tests.py` covering `home` 200, `sw.js` content-type + `Service-Worker-Allowed` header, `manifest.webmanifest` 200, `offline/` 200 (these endpoints currently have no direct tests); move the `spa_shell`/`react_app`/`app_redirect` tests from `google_tasks/tests.py` if touched anyway |
| R. Revisit (after last app cutover) | Re-evaluate the thin-`home`-entry option above; if done: public shell variant, `input.home` in `vite.config.ts`, `/` serves the shell, delete `home.html`, bump `PWA_CACHE_VERSION` |

## Risks / gotchas

- **Cross-cutting infra is the only real risk.** Any edit to
  `spa_shell`/`react_app`/`app_redirect`/`api.py`/`spa_shell.html`
  affects every mounted SPA — there is no per-app isolation. Verify
  against every live mount before merging.
- **Don't let the home page become auth-gated.** A React rewrite via
  `spa_shell` would silently make `/` login-only, regressing the
  public landing page and the PWA install entry — the main reason to
  keep the template.
- **PWA precache of `/`.** `PRECACHE_URLS` fetches `/` at SW install;
  keep it a cheap HTML page. If `/` ever becomes a shell, confirm the
  entry bundle lands in the SW cache before first offline open.
- **`home.html` links are name-based.** App cutovers must keep the
  `{% url %}` names it uses (`finance:accounts`,
  `google_tasks:dashboard`, `google_api:gmail`,
  `single_pages:twister`, `tv_archive:tv-arhivs`,
  `bible_research:generate_audio`) — already a requirement of the
  per-app plans, restated here as the consumer.
- **`sw.js`/`manifest` are templates.** Never "optimize" them into
  `static/` files or Vite outputs — the `cache_version` context and
  root scope are load-bearing.
- **`burger_menu.html` vs `BurgerMenu.tsx` duplication** persists
  until the last template app dies — a deliberate parallel track,
  not drift to fix.
- **`utils.translate_lv_to_eng`** depends on unofficial
  `googletrans` and may break externally (documented in AGENTS.md) —
  orthogonal to any frontend work.

## Verification checklist

```bash
source venv/bin/activate
python manage.py check
python manage.py test django_apps google_tasks finance
# (openapi.json/gen:types unchanged — no django_apps router added)
```

Manual checks:

- `/` renders the card directory for an **anonymous** session; every
  card link resolves (including into `/tasks/` SPA and, during
  staging, both `/finance/` template and `/finance/app/` SPA).
- `/sw.js` returns `application/javascript` with
  `Service-Worker-Allowed: /` and the current `CACHE_VERSION`;
  `/manifest.webmanifest` and `/offline/` return 200 with correct
  content types.
- Dev-tools Application tab: SW registers with scope `/`; offline
  reload of `/` serves the precached page.
