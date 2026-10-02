---
name: new-react-app
description: Create a new Django app in this repo the React-first way — ninja API router at /api/<entry>/, Vite SPA entry at frontend/src/<entry>/ served by the shared spa_shell, generated api-types, i18n catalogs, tests. Use when asked to add a new app, feature app, or SPA page set to the django-apps project.
argument-hint: "<app-name>"
allowed-tools:
  - read
  - edit
  - grep
  - glob
  - exec
---

# New Django app → React-first playbook

New apps are React-first: the UI is a Vite entry under
`frontend/src/<entry>/` served by the shared `spa_shell`, and all
data flows through a django-ninja router mounted at
`/api/<entry>/`. There are **no templates, no app `static/` dir, no
form-POST views** to build — go straight to the post-cutover shape
`tasks`/`finance`/`gmail` are in.

Copy-paste code templates for every step live in
[references/boilerplate.md](references/boilerplate.md) — read it
once before writing files. `frontend/src/finance/` is the canonical
reference implementation (never delegated to legacy views);
`src/gmail/` is a smaller single-page example.

## Naming invariants

The shared plumbing keys everything off one slug. Pick a short
lowercase identifier matching `django_apps.views.SPA_ENTRY_RE`
(`[a-z0-9_]+`) and use it consistently:

| Thing | Rule |
|---|---|
| Vite entry folder | `frontend/src/<entry>/` |
| Vite `rollupOptions.input` key | `<entry>: 'src/<entry>/main.tsx'` |
| `react_app` `entry=` arg | `partial(react_app, entry='<entry>', …)` |
| Public URL prefix | `/<entry>/` (`BrowserRouter basename='/<entry>'`) |
| Ninja router mount | `api.add_router('/<entry>/', …)` → `/api/<entry>/` |
| Generated types file | `frontend/src/<entry>/api-types.ts` (fixed name) |
| Query-key namespace | `['<entry>', …]` |

Prefer the Django package name equal to the entry slug
(`finance`/`gmail`/`single_pages` do this; `google_tasks` → `tasks`
is the legacy exception). Equal slugs keep `spa_url_for`'s default
`/api/<entry>/<sub>` → `/<entry>/<sub>` rewrite working for login
`next` and avoid a `SPA_BASES` entry.

## Checklist

Ordered so each step is verifiable before the next. One PR can
cover the whole skeleton for a small app.

### 1. Django app + URL mount

1. `python manage.py startapp <app>`; add `'<app>'` to
   `INSTALLED_APPS` in `django_apps/settings.py` (plain package
   name — this repo doesn't use `AppConfig` paths).
2. `<app>/urls.py` — direct root mount, no strangler stage. Mount
   `partial(react_app, entry='<entry>', title='<Title>')` on `''`
   plus `'<path:subpath>'` (no trailing slash — it matches both
   `x` and `x/` so client-side routes need no APPEND_SLASH hop).
   `react_app` already enforces the contract: GET/HEAD → shell,
   any other method → 404. **Never add POST views under
   `/<entry>/`** — mutations live under `/api/` only.
3. `django_apps/urls.py` — import the router, add
   `api.add_router('/<entry>/', <entry>_router)` next to the
   existing calls, and `path('<entry>/', include('<app>.urls',
   namespace='<app>'))` in `urlpatterns`.
   If the app legitimately has no API (pure static content), the
   router mount may be omitted — everything else still applies.

### 2. Ninja router — `<app>/api.py`

Boilerplate in the reference file. Non-optional conventions —
shared infra depends on them:

- **Mutations are implemented directly in `api.py`** (the finance
  pattern), reusing forms (`Form(payload.dict())` keeps validation
  identical) and `services/` functions. The google_tasks `_adapt` →
  `views.py` delegation is a rewrite artifact; new apps have
  nothing to delegate to.
- **Success shape**: mutation ops return `{'success': True,
  'message': '…'}` (`MessageOut`, or a subclass carrying result
  data plus an optional `code`/`params` i18n pair) — the SPA toasts
  it, matching the sentence a template UI would show via
  `django.contrib.messages`.
- **Errors**: raise `HttpError(status, 'detail')` — or
  `ApiHttpError(status, 'detail', code=…, params=…)` when the SPA
  should localize it via the `server` catalog — or let the shared
  handlers shape it (400 form errors, 404, 409, 502). Never
  hand-roll `{'error': …}` JsonResponses in the router;
  `django_apps/api.py` produces the uniform `{error: slug, detail}`
  shape (`_ERROR_SLUGS`).
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

Minimum layout (copy from `frontend/src/finance/`):

```
frontend/src/<entry>/
  main.tsx            # initI18n('<entry>', {en, lv}) → createRoot +
                      # QueryClientProvider(shared queryClient) +
                      # BrowserRouter basename='/<entry>'
  App.tsx             # <Routes>; '/' and '*' → <Navigate> to the
                      # default page
  api-types.ts        # generated — never edit (gen:types)
  api.ts              # `components['schemas'][...]` type aliases +
                      # typed fetchers over shared/api/client.ts
  mutations.ts        # useMutation hooks → pushToast +
                      # invalidateQueries({queryKey: ['<entry>']})
  locales/            # en.json + lv.json catalogs (namespace
                      # '<entry>'; shared strings via 'common:')
  routes/             # one component per SPA page
  components/<App>NavBar.tsx  # shared NavBar + BurgerMenuItem list
```

i18n is part of the skeleton, not an afterthought:
`initI18n('<entry>', { en, lv })` before render, components call
`useTranslation('<entry>')`, and eslint's
`i18next/no-literal-string` warns on raw literals. Mutation toast
bodies resolve `code`/`params` through the `server` catalog via
`serverText(data, data?.message)` — see `src/finance/mutations.ts`.
(Latvian- or English-only pages can opt out per-file like
single_pages does, but that's a deliberate product decision.)

NavBar: in-SPA links use `to:` (React Router, no reload); Home
(`url: '/'`) and `` `Logout (${user})` `` (`url: '/admin/logout/'`)
stay `url:` anchors. Username and language come from
`useBootstrap()` (the `spa-bootstrap` json_script — `{user,
language}`).

### 4. Register the entry in the build

- `frontend/vite.config.ts` → `rollupOptions.input`:
  `<entry>: 'src/<entry>/main.tsx'`. This is what makes
  `{% vite_asset 'src/<entry>/main.tsx' %}` resolve in
  `spa_shell.html` — the manifest key must exist or prod renders
  the "React entry not loaded" diagnostic.
- `frontend/package.json` `gen:types` — a `for entry in …` loop
  over a hardcoded slug list (`src/shared` and `src/test` aren't
  entries, so no glob). Add `<entry>` to the list.
- Regenerate and commit both artifacts (CI regenerates and fails
  on drift — the check covers `src/*/api-types.ts` and
  `frontend/openapi.json`):

  ```bash
  source venv/bin/activate
  python manage.py export_openapi_schema \
      --output frontend/openapi.json
  printf '\n' >> frontend/openapi.json   # committed file keeps the
                                         # trailing newline (CI diff)
  npm run gen:types --prefix frontend
  ```

- **Bump `PWA_CACHE_VERSION`** in `django_apps/views.py` so the
  service worker drops cached shells/assets. No other `sw.js`
  change needed — `/api/` is already in `BYPASS_PATHS` and
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
  for pages with real logic; `src/test/setup.ts` is shared.
- **Playwright smoke** `frontend/tests/e2e/<entry>.smoke.spec.ts` —
  copy `finance.smoke.spec.ts`: an unauthenticated block (mount
  302s to `/login/?next=…`, API 401s) plus a small authenticated
  block behind `E2E_USERNAME`/`E2E_PASSWORD`. Opt-in
  (`npm run test:e2e`), not part of `npm test` or CI.

### 6. Docs

- Root `AGENTS.md`: add the app to the Repository map table and
  the URL-routing paragraph.
- `<app>/AGENTS.md` (new): external APIs, data model, which service
  functions the ninja ops reuse — mirror `finance/AGENTS.md` /
  `gmail/AGENTS.md` shape.
- `frontend/README.md`: update the commands list if it names
  per-app `api-types.ts` outputs explicitly.

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
`http://localhost:8000/<entry>/` (browse Django's port, not
Vite's) — page renders, a mutation toasts, a deep link
`/<entry>/<page>` loads directly.

## Out of scope / gotchas

- **OAuth / external-consent flows** — Google OAuth lives in
  `google_api` (shared). If the new app needs it, reuse
  `get_user_credentials()`/`get_creds_dict()` and raise
  `GoogleReauthRequired` so dead creds surface as `401
  {error: 'google_reauth', authorization_url}` — never re-implement
  the flow. App-specific consent callbacks (like finance's
  `requisition_callback`) stay **Django views routed before the
  catch-all** — a browser navigation ending in a redirect, never a
  fetch.
- **Public pages** — `react_app`/`spa_shell` are login-required by
  default and that stays the norm. For a genuinely public page the
  plan is `react_app_public` + `auth=None` on the ninja ops — that
  variant hasn't landed yet (`django_apps/views.py` still needs
  `_spa_shell`/`_react_app` extracted), so implement the split if
  needed and keep the login-required wrappers intact.
- **Root-mounted apps** — mounting at `path('')` means no
  `<path:subpath>` catch-all (it would shadow every later include).
  If the public base differs from the entry slug, add a `SPA_BASES`
  entry in `django_apps/api.py::spa_url_for` so login `next`
  collapses API URLs to the SPA base. Prefer equal slugs so none
  of this machinery is needed.
- **PWA plumbing** — `sw.js`, manifest, offline page are global;
  the only touch is the `PWA_CACHE_VERSION` bump.
- **Docker / Vercel / CI** — the node build stage,
  `build_files.sh` and `frontend.yml` are entry-agnostic; a new
  input key needs no infra delta.
- **Cross-app imports** stay one-directional — apps import
  `google_api`/`services/`, never each other's API routers.
- **`spa_url_for` dashboard special-case** — `/api/<app>/dashboard*`
  maps to `/<app>/` for login `next` (tasks-specific legacy).
  Naming a page "dashboard" inherits this; harmless, or name the
  index something else.
- **Keep this skill in sync** — when work lands something reusable
  (new `shared/` module, new plumbing in `django_apps/views.py` or
  `api.py`), update this SKILL.md and the AGENTS.md conventions
  bullet so the next app inherits it.
