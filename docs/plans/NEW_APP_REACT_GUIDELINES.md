# New Django App → React-First — generic agent playbook

> **Status**: Living reference (kept in `docs/plans/` per the repo
> rule that all plan documents live here). Derived from the two
> completed/in-flight rewrites — `GOOGLE_TASKS_REACT_REWRITE.md`
> (done, `/tasks/` is the SPA) and `FINANCE_REACT_REWRITE.md`
> (strangler stage). Use this for **new apps**; existing-app
> rewrites follow their own per-app plan in `docs/plans/` (see
> "Relationship to per-app rewrite plans" below).
>
> The condensed version of this checklist should also live in the
> root `AGENTS.md` Conventions section — see "Where these
> instructions live".

New apps are React-first: the UI is a Vite entry under
`frontend/src/<entry>/` served by the shared `spa_shell`, and all
data flows through a django-ninja router mounted at
`/api/<entry>/`. There are **no templates, no app `static/` dir, no
form-POST views** to build or later strangle away — go straight to
the post-cutover shape `google_tasks` ended in.

## Naming invariants (must hold across every app)

The shared plumbing keys everything off one slug. Pick a short
lowercase identifier matching `django_apps.views.SPA_ENTRY_RE`
(`[a-z0-9_]+`) and use it consistently:

| Thing | Rule | Example |
|---|---|---|
| Vite entry folder | `frontend/src/<entry>/` | `src/tasks/`, `src/finance/` |
| Vite `rollupOptions.input` key | `<entry>` | `tasks: 'src/tasks/main.tsx'` |
| `spa_shell`/`react_app` `entry=` arg | `<entry>` | `partial(react_app, entry='tasks', …)` |
| Public URL prefix | `/<entry>/` (`BrowserRouter basename='/<entry>'`) | `/tasks/` serves entry `tasks` |
| Ninja router mount | `api.add_router('/<entry>/', …)` → `/api/<entry>/` | `/api/tasks/` |
| Generated types file | `frontend/src/<entry>/api-types.ts` | always named `api-types.ts` |

The **Django package name may differ** from the entry slug
(`google_tasks` → entry `tasks`), but for new apps prefer them
equal — it removes a translation step everywhere (`spa_url_for`
maps `/api/<entry>/<sub>` → `/<entry>/<sub>` for login `next`).

**Root-mounted apps are the documented exception.** Existing apps
included under `path('')` may have a public base that differs from
the entry slug (`tv_archive` → `/tv-arhivs`, `google_api` →
`/gmail/`) or no single base at all (`single_pages` → `/twister`,
`/spoki`). For those:

- The ninja router mount follows the **public URL base** when one
  exists (`/api/tv-arhivs/` for a `/tv-arhivs` page) so
  `spa_url_for`'s default rewrite keeps working; when the API
  outlives one page, mounting at the package name
  (`/api/google_api/`) plus a `SPA_BASES` entry is the documented
  alternative (see the google_api plan).
- `SPA_BASES` in `django_apps/api.py::spa_url_for` maps
  API-prefix → SPA base for apps the default `/<app>/` rewrite
  gets wrong (`{'google_api': '/gmail', 'single_pages': '/twister',
  …}`); mapped entries collapse the API subpath to the base and
  keep only the query string.
- `app_redirect(base='')` needs the empty-base guard for
  root-level 301s (single_pages Stage 0 owns the fix).

New apps should keep all slugs equal so none of this machinery is
needed.

## Where these instructions live

**Decision**: the canonical checklist lives in **root `AGENTS.md`
(Conventions section)** — a ~15-line condensed version linking here.
This document is the long-form playbook with boilerplate and
rationale.

Justification: `AGENTS.md` is the one file every agent session reads
(the repo map, hard rules and conventions all funnel there);
`docs/plans/` is discoverable only via the AGENTS.md pointer and is
where the repo rule forces plan documents to live anyway. A third
file like `docs/REACT_APP_GUIDE.md` would fragment things: agents
would have to know to look for it, and it would compete with this
document. So: pointer + checklist in `AGENTS.md`, full detail here.

## Canonical "new app" checklist

Ordered so each step is verifiable before the next. One PR can
cover the whole skeleton for a small app.

### 1. Django app + URL mount

1. `python manage.py startapp <app>`; add `'<app>'` to
   `INSTALLED_APPS` in `django_apps/settings.py` (plain package name —
   this repo doesn't use `AppConfig` paths in INSTALLED_APPS).
2. `<app>/urls.py` — **direct root mount, no strangler stage**
   (nothing to strangle):

   ```python
   from functools import partial

   from django.urls import path
   from django_apps.views import react_app

   app_name = '<app>'

   react_app_<app> = partial(react_app, entry='<entry>', title='<Title>')

   urlpatterns = [
       # External callbacks / non-SPA Django views go BEFORE the
       # catch-all — see "External callbacks" below.
       path('', react_app_<app>, name='index'),
       # No trailing slash on <path:subpath>: it matches both 'x' and
       # 'x/', so client-side routes don't need an APPEND_SLASH hop.
       path('<path:subpath>', react_app_<app>, name='spa_subpath'),
   ]
   ```

   `react_app` (django_apps/views.py) already enforces the contract:
   GET/HEAD → `spa_shell` (login_required + ensure_csrf_cookie +
   bootstrap `json_script`), any other method → **404**. Do not add
   POST views under `/<entry>/` — mutations live under `/api/` only.

   For a genuinely **public** page, use `react_app_public` instead
   (the undecorated shell variant the tv_archive plan's Stage 1
   introduces by extracting `_spa_shell`/`_react_app`) — and pair it
   with `auth=None` on the ninja ops. If that variant hasn't landed
   yet, implement the same split: keep `spa_shell`/`react_app` as
   the login-required wrappers. Default stays login-required —
   public is a deliberate product decision, not the norm.

3. `django_apps/urls.py`:
   - `from <app>.api import router as <entry>_router` at the top;
   - `api.add_router('/<entry>/', <entry>_router)` next to the
     existing `add_router` calls;
   - `path('<entry>/', include('<app>.urls', namespace='<app>'))` in
     `urlpatterns`.

   If the app legitimately has no API at all (pure static content),
   the router mount may be omitted — everything else still applies.

### 2. Ninja router — `<app>/api.py`

```python
"""django-ninja router for <app> (mounted at /api/<entry>/)."""
from ninja import Router, Schema
from django.shortcuts import get_object_or_404

router = Router()


class ItemOut(Schema):
    id: int
    name: str


class MessageOut(Schema):          # the {success, message} contract
    success: bool
    message: str


@router.get('/items/', response=List[ItemOut])
def items(request):
    return Item.objects.filter(owner=request.user)


@router.post('/items/{item_id}/rename/', response=MessageOut)
def rename(request, item_id: int, payload: RenameIn):
    item = get_object_or_404(
        Item, id=item_id, owner=request.user)   # per-user scoping
    ...
    return {'success': True, 'message': f'Renamed to {item.name}.'}
```

Conventions that are **not optional** — shared infra depends on them:

- **Mutations are implemented directly in `api.py`** (the finance
  pattern), reusing forms (`Form(payload.dict())` keeps validation
  identical) and `services/` functions. The google_tasks `_adapt` →
  `views.py` delegation is a rewrite artifact for code that already
  existed; new apps have nothing to delegate to.
- **Success shape**: mutation ops return `{'success': True,
  'message': '…'}` (`MessageOut`, or a subclass carrying result
  data) — the SPA toasts `message`, matching the sentence a
  template UI would show via `django.contrib.messages`.
- **Errors**: raise `HttpError(status, 'detail')` or let the shared
  handlers shape it — 400 form errors, 404 not-found, 409 conflicts,
  502 upstream. Never hand-roll `{'error': …}` JsonResponses in the
  router; `django_apps/api.py` handlers produce the uniform
  `{error: slug, detail}` shape (`_ERROR_SLUGS`).
- **Per-user isolation**: every queryset scoped by `request.user`
  (`for_user()` helpers where they exist); `get_object_or_404`
  always carries a user predicate.
- **Query params** via `Query(None, max_length=…)`; filters come in
  as GET params so SPA pages stay bookmarkable.
- **Few fat endpoints**: one GET per page returning everything the
  page needs (including dropdown option lists) — on Vercel
  `CONN_MAX_AGE=0` and Aiven `max_connections` is low, so granular
  per-widget calls are the risk, not response size. Keep bulk
  mutations as one POST that loops server-side.
- **Money**: `Decimal` serializes as a JSON string — keep it a
  string end-to-end, precompute display math server-side.

### 3. Frontend entry — `frontend/src/<entry>/`

Minimum layout (copy from `frontend/src/finance/` — it is the
cleaner of the two reference implementations since it never had to
delegate to legacy views):

```
frontend/src/<entry>/
  main.tsx            # createRoot + QueryClientProvider +
                      # BrowserRouter basename='/<entry>'
  App.tsx             # <Routes>; '/' → Navigate to default page;
                      # '*' → same redirect
  api-types.ts        # generated — do not edit (gen:types)
  api.ts              # schema type aliases + typed fetchers over
                      # shared/api/client.ts
  mutations.ts        # useMutation hooks → pushToast(message) +
                      # invalidateQueries({queryKey: ['<entry>']})
  routes/             # one component per SPA page
  components/
    <App>NavBar.tsx   # shared NavBar + BurgerMenuItem list
```

**`main.tsx`** — identical to `src/finance/main.tsx` except the
basename (and optional CSS import):

```tsx
import 'vite/modulepreload-polyfill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/<entry>">
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
```

**`App.tsx`** — a `<Routes>` table; `'/'` and `'*'` both
`<Navigate>` to the default page (see `src/finance/App.tsx`).

**`api.ts`** — type aliases (`export type XOut =
components['schemas']['XOut']`) plus thin fetchers that build
`URLSearchParams` for filters (see `src/finance/api.ts`). Query keys
should be namespaced `['<entry>', …]`.

**`mutations.ts`** — `useMutation` wrappers calling `apiPost`; on
success `pushToast(data.message, data.success ? 'success' :
'warning')`, on error `pushToast('…: ' + errorDetail(error))`, on
settled `invalidateQueries({ queryKey: ['<entry>'] })` (see
`src/finance/mutations.ts`).

**`<App>NavBar.tsx`** — shared `NavBar` with a `BurgerMenuItem[]`:
in-SPA links use `to:` (React Router, no reload); Home (`url:
'/'`) and `` `Logout (${user})` `` (`url: '/admin/logout/'`) stay
`url:` anchors. Username comes from `useBootstrap()` (the
`spa-bootstrap` json_script `spa_shell` renders — currently `{user}`
only). See `src/finance/components/FinanceNavBar.tsx`.

### 4. Register the entry in the build

- `frontend/vite.config.ts` → `rollupOptions.input`:
  `<entry>: 'src/<entry>/main.tsx'`. This is what makes
  `{% vite_asset 'src/<entry>/main.tsx' %}` resolve in
  `spa_shell.html` — the manifest key must exist or prod renders the
  "React entry not loaded" diagnostic.
- `frontend/package.json` `gen:types` — currently a hardcoded
  `openapi-typescript … && openapi-typescript …` chain emitting one
  `api-types.ts` per entry. Add a third `openapi-typescript
  ../frontend/openapi.json -o src/<entry>/api-types.ts` clause.
  **Better**: when adding the third app, refactor `gen:types` into a
  loop over `src/*/main.tsx` folders so this step stops existing.
- Regenerate:

  ```bash
  source venv/bin/activate
  python manage.py export_openapi_schema \
      --output frontend/openapi.json
  printf '\n' >> frontend/openapi.json   # committed file keeps the
                                         # trailing newline (CI diff)
  npm run gen:types --prefix frontend
  ```

  Both artifacts are committed; CI regenerates and fails on drift.

- **Bump `PWA_CACHE_VERSION`** in `django_apps/views.py` so the
  service worker drops cached shells/assets. No other `sw.js`
  change is needed — `/api/` is already in `BYPASS_PATHS` and
  navigations are network-first.

### 5. Tests

- **Django `TestCase` in `<app>/tests.py`** driving `/api/<entry>/`
  URLs with `self.client`: unauthenticated GET → 401
  `{error: unauthenticated, login_url}`; POST without CSRF → 403;
  per-user isolation (user B can't see/mutate user A's rows);
  mutation success shape `{success, message}`; validation → 422.
  Factory `make_*` helpers, mock external APIs with
  `unittest.mock.patch`.
- **Vitest + RTL** next to routes (`src/<entry>/routes/*.test.tsx`)
  for pages with real logic; mutations/toasts where they carry
  behavior. `src/test/setup.ts` is shared.
- **Playwright smoke** `frontend/tests/e2e/<entry>.smoke.spec.ts` —
  copy `tasks.smoke.spec.ts`: an unauthenticated block (mount 302s
  to `/login/?next=…`, API 401s) plus a small authenticated block
  behind `E2E_USERNAME`/`E2E_PASSWORD`. Opt-in (`npm run test:e2e`),
  not part of `npm test` or CI.

### 6. Docs

- Root `AGENTS.md`: add the app to the Repository map table and the
  URL-routing paragraph; the React-SPA-mounts convention bullet
  already covers the pattern — no edit needed there beyond the
  pointer to this doc (see "Where these instructions live").
- `<app>/AGENTS.md` (new): external APIs, data model, which service
  functions the ninja ops reuse — mirror `finance/AGENTS.md` /
  `google_tasks/AGENTS.md` shape.
- `frontend/README.md`: the commands list mentions per-app
  `api-types.ts` outputs — update if it still names `tasks` only.

## Verification (run before calling it done)

```bash
source venv/bin/activate
python manage.py check
python manage.py test <app>
npm run typecheck --prefix frontend && npm run lint --prefix frontend
npm test --prefix frontend
python manage.py export_openapi_schema --output frontend/openapi.json \
    && printf '\n' >> frontend/openapi.json \
    && npm run gen:types --prefix frontend
git status --porcelain    # openapi.json + api-types.ts committed
npm run build --prefix frontend   # manifest gains the new key
```

Manual: `VITE_DEV=1 python manage.py runserver` +
`npm run dev --prefix frontend`, open
`http://localhost:5273/<entry>/` — page renders, a mutation toasts,
a deep link `/<entry>/<page>/` loads directly.

## Out of scope for new apps

- **OAuth / external-consent flows** — Google OAuth lives in
  `google_api` (shared). If a new app needs it, reuse the existing
  credential helpers and surface dead creds as `401
  {error: 'google_reauth', authorization_url}` via
  `GoogleReauthRequired` — do not re-implement the flow. Consent
  callbacks like finance's `requisition_callback` are app-specific;
  when they exist they stay **Django views routed before the
  catch-all** (a browser navigation ending in a redirect, never a
  fetch).
- **PWA plumbing** — `sw.js`, manifest, offline page are global and
  already include `/api/` bypass; the only touch is the
  `PWA_CACHE_VERSION` bump.
- **Docker / Vercel / CI workflow changes** — the node build stage,
  `build_files.sh` and `frontend.yml` are entry-agnostic; a new
  input key needs no infra delta (verified by the finance mount).
  Exception: the OpenAPI drift check in `frontend.yml` currently
  diffs only `src/tasks/api-types.ts` — generalize it to all
  `src/*/api-types.ts` when the third app lands (gap to fix, see
  below).
- **Service layers imported by other apps** — keep cross-app
  imports one-directional (apps import `google_api`/`services/`,
  never each other's API routers).
- **django-vite / spa_shell changes** — `spa_shell.html` already
  takes `title` + `vite_entry`; Bootstrap CDN is in the shell;
  Bootstrap JS is intentionally absent (Modal/Dropdown re-implemented
  in `shared/`).

## Relationship to the per-app rewrite plans

Per-app plans in `docs/plans/` — `GOOGLE_TASKS_REACT_REWRITE.md`
(done), `FINANCE_REACT_REWRITE.md` (staged),
`BIBLE_RESEARCH_REACT_REWRITE.md`, `TV_ARCHIVE_REACT_REWRITE.md`,
`SINGLE_PAGES_REACT_REWRITE.md`, `GOOGLE_API_REACT_REWRITE.md`,
`DJANGO_APPS_REACT_REWRITE.md` — are **authoritative for their
app's legacy quirks**: strangler mounts (`/finance/app/` basename
until Stage 6), external `reverse()` names that must keep
resolving, `_adapt` delegation, callback URLs baked into
third-party config, root-mount adaptations (`SPA_BASES`,
`react_app_public`, basename-less routes), test-suite repointing.
This document is authoritative for the **greenfield shape** — what
a brand-new app looks like and which shared contracts it must
honour.

They must not drift: when a rewrite lands something reusable (e.g.
`errorDetail` → `shared/api/errors.ts`, `toasts.ts` → `shared/`),
update this doc's checklist and the AGENTS.md conventions bullet so
the next app inherits it.

## Known gaps / follow-ups this doc codifies

- **`frontend.yml` OpenAPI drift check** diffs only
  `src/tasks/api-types.ts` — `src/finance/api-types.ts` (and any new
  app) can drift silently. Change the porcelain check to
  `src/**/api-types.ts`.
- **`gen:types` scaling** — hardcoded `&&` chain, one clause per
  entry. Third app should switch it to a loop (e.g. a tiny
  `scripts/gen-types.mjs`) so new apps need zero package.json edits.
  Every per-app plan says "whichever lands first introduces the
  loop; rebase the others on top".
- **`spa_url_for` generalizations** — the root-mount rewrites
  introduce `SPA_BASES` (API-prefix → SPA base override, subpath
  collapses to base); whichever of single_pages/google_api Stage 0
  lands first adds it, the other adds its entry. New apps that keep
  slugs equal never touch it.
- **`app_redirect(base='')`** — produces `'//'` (protocol-relative)
  today; the single_pages plan's Stage 0 owns the empty-base fix.
- **`spa_url_for` dashboard special-case** — maps
  `/api/<app>/dashboard*` → `/<app>/` for login `next`. A new app
  that names a page "dashboard" gets root-mapped; name the index
  something else or accept the behaviour (it's tasks-specific
  legacy, harmless).
