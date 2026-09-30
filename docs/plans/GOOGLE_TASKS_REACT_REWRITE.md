# React Frontend Platform — google_tasks as First App

> **Status**: Vercel manifest spike in progress — a minimal Stage 1
> subset (frontend workspace, django-vite, `/tasks/app/` shell) ships
> first. Running `npm ci`/`npm run build` inside `build_files.sh`
> failed on Vercel preview deploys (no log access to diagnose), so
> **`frontend_dist/` is committed to the repo** and `build_files.sh`
> runs no npm — regenerate it locally with
> `npm run build --prefix frontend` and commit the result. If the
> deploy goes green, record under "Vercel manifest spike" below that a
> committed manifest lands in the lambda (guaranteed — it's source,
> not build output) and revisit build-time generation separately.

## Decision

One shared React frontend workspace **in this repo** at the root
`frontend/` (Vite + React + TypeScript), with **one entry per Django
app**. `google_tasks` is the first entry (`tasks`); `finance` and
others follow by adding an entry folder, a shell view and API
endpoints — no new build or deploy plumbing.

Django remains the backend: session auth, Google OAuth, `services.py`
sync logic — all unchanged. Same-origin SPA: no JWT, no CORS, no
second deploy pipeline. Assets are built at image/build time and
served by Django/WhiteNoise (Cloud Run) and the Vercel static route.

Platform building blocks (reused by every future app):

| Layer | Choice | Lives in |
|---|---|---|
| Build | Vite, multi-entry, one `package.json` | `frontend/` |
| Django ↔ Vite glue | `django-vite` (`{% vite_asset %}`, HMR in dev, manifest in prod) | `settings.py`, shell templates |
| API | `django-ninja` (Pydantic schemas → OpenAPI) | `<app>/api.py`, shared bits in `django_apps/api.py` |
| TS types | generated from OpenAPI via `openapi-typescript` | `frontend/src/<app>/api-types.ts` |
| Server state | TanStack Query | per entry |
| Routing | React Router, `basename` per entry | per entry |
| Shared UI/infra | fetch client, CSRF, auth/OAuth redirect, NavBar/burger menu, Bootstrap | `frontend/src/shared/` |
| Quality | `tsc --noEmit`, ESLint + Prettier, Vitest + React Testing Library, a few Playwright smoke tests | `frontend/`, CI |

## Workspace layout

```
frontend/
  package.json            # single install for all apps
  package-lock.json
  .nvmrc                  # node 22 — Vercel + Docker match
  vite.config.ts          # input: { tasks: 'src/tasks/main.tsx', ... }
  eslint.config.js
  src/
    shared/
      api/client.ts       # fetch wrapper: CSRF, 401 → navigate
      api/errors.ts
      components/NavBar.tsx, BurgerMenu.tsx, Modal.tsx
      hooks/
    tasks/
      main.tsx            # createRoot + <BrowserRouter basename>
      routes/
      components/
      api-types.ts        # generated — do not edit
    finance/              # later
  tests/e2e/              # Playwright smoke tests
```

Vite output goes to repo-root `frontend_dist/` with an app namespace
so entries never collide under `STATIC_URL`:

```ts
// vite.config.ts (sketch)
export default defineConfig({
  base: '/static/',
  build: {
    outDir: '../frontend_dist',
    emptyOutDir: true,
    manifest: 'manifest.json',
    rollupOptions: {
      input: { tasks: 'src/tasks/main.tsx' },
      output: {
        entryFileNames: '[name]/[name].[hash].js',
        chunkFileNames: 'shared/[name].[hash].js',
        assetFileNames: '[name]/[name].[hash][extname]',
      },
    },
  },
  server: {
    proxy: {
      '^/(?!static/|@vite|src/|node_modules/)': 'http://localhost:8000',
    },
  },
});
```

## Current frontend surface (what's being replaced)

### Templates (~1,900 lines)

| Template | Lines | Becomes |
|---|---|---|
| `dashboard.html` | 82 | React route `/` (under `/tasks/`) |
| `archived.html` | 407 | route `/archived` |
| `trash.html` | 352 | route `/trash` |
| `search.html` | 308 | route `/search` |
| `task_detail.html` | 384 | route `/task/:id` |
| `navbar.html` | 191 | shared `<NavBar>` + tasks filter components |
| `task_card.html` | 68 | `<TaskCard>` |
| `divider_card.html` | 25 | `<DividerCard>` |
| `completed_tasks.html` | 45 | `<CompletedSection>` |
| `modals.html` | 41 | shared `<Modal>` + tasks modals |
| `create_task_modal.html` | 78 | `<CreateTaskModal>` |
| `floating_controls.html` | 29 | `<FloatingControls>` |
| `dashboard.css` | 256 | imported into `tasks` entry as-is initially |

### JS (~1,850 lines)

| File | Lines | React equivalent |
|---|---|---|
| `task_actions.js` | 342 | TanStack mutation hooks calling the API |
| `create_task.js` | 297 | `<CreateTaskModal>` logic |
| `filters.js` | 225 | URL search params + filter state |
| `autosync.js` | 219 | `useEffect` interval + sync mutation |
| `action_history.js` | 204 | undo/redo store (localStorage, 50-cap) |
| `dividers.js` | 170 | divider components + mutations |
| `reorder.js` | 132 | drag-drop (replace SortableJS with `dnd-kit`) |
| `main.js` | 116 | entry bootstrap |
| `utils.js`, `config.js` | 144 | `shared/api/client.ts` + config |

### Backend surface

- **Read views to expose as API** (7): `dashboard`, `starred_tasks`,
  `overdue_tasks`, `archived_tasks`, `trash_tasks`, `task_detail`,
  `search_tasks`. They share context machinery; flags
  (`is_starred_view`, etc.) currently flow via
  `get_dashboard_js_config` → move into the response schema per view.
- **Mutation endpoints already JSON** (~16): reorder×2, toggle_star,
  sync, complete/uncomplete, process_labels×2, divider×3,
  archive/unarchive, delete/restore/permanent-delete,
  create/update task — re-expose as ninja operations calling the same
  service code; old paths stay until the templates are deleted.
- **Special flows to preserve**: OAuth dict responses
  (`{'authorization_url', ...}`) and `reauth_redirect` behavior
  (stored-but-dead creds → OAuth). `fetch` can't render a login page
  or follow Google redirects, so the API must return `401` + URL
  instead of HTTP-redirecting (see auth contract below).

## Shared Django layer (`django_apps/api.py`)

Written once in Stage 0, imported by every app's `api.py`:

- `NinjaAPI` instance mounted at `/api/`, with per-app routers:
  `api.add_router('/tasks/', tasks_router)` → `/api/tasks/...`;
  `finance` later adds `/api/finance/...`. One OpenAPI schema at
  `/api/openapi.json` for all apps.
- **Auth**: ninja's `django_auth` session auth (it enforces CSRF on
  unsafe methods — confirm with a test that a POST without
  `X-CSRFToken` is rejected). An
  unauthenticated request returns `401` JSON
  `{"error": "unauthenticated", "login_url": "/admin/login/?next=..."}`
  — never a 302.
- **OAuth**: a shared exception handler/helper maps the services'
  `{'authorization_url', 'state', 'scopes'}` dict (and the
  `reauth_redirect` "creds dead" case) to `401`
  `{"error": "google_reauth", "authorization_url": "..."}`. The
  OAuth `state` must still be stored in the session exactly as the
  current views do — reuse that code, don't re-implement it.
- **Errors**: uniform `{"error": "...", "detail": ...}` with the HTTP
  status; Pydantic validation errors come back as ninja's `422`.
- **Shell view helper**: `spa_shell(request, entry, title)` decorated
  with `@login_required` + `@ensure_csrf_cookie`, rendering
  `django_apps/templates/spa_shell.html` (includes `pwa/head.html`,
  `{% vite_asset %}` for the entry, and an optional `json_script`
  bootstrap payload such as the user name and burger menu items).

`django-ninja` fits the repo conventions: operations are plain
functions, no class-based views. Update root `AGENTS.md` and
`google_tasks/AGENTS.md` conventions in Stage 6 to say "API endpoints
use django-ninja; page views stay function-based".

### Frontend client contract (`frontend/src/shared/api/client.ts`)

- Reads `csrftoken` cookie, sends `X-CSRFToken` on unsafe methods,
  `credentials: 'same-origin'`.
- `401` with `authorization_url` or `login_url` → `window.location`
  to it (never follow redirects inside `fetch`).
- Other non-2xx → throws a typed `ApiError` that TanStack Query
  surfaces to the UI.
- Typed via `openapi-fetch` + generated `api-types.ts`, so request
  and response shapes are checked against the Django schema.

## API contract (Stage 0 output — do this first)

`google_tasks/api.py` (ninja `Router`), mounted under `/api/tasks/`:

```
GET  /api/tasks/dashboard/?list=&label=&order=  → DashboardOut
     {tasks, completed, task_lists, labels, selected_*, flags}
GET  /api/tasks/starred/  /overdue/  /archived/  /trash/
GET  /api/tasks/task/{task_id}/                 → TaskDetailOut
GET  /api/tasks/search/?q=
POST /api/tasks/sync/
POST /api/tasks/task/{task_id}/complete/  ...  (one operation per
     existing mutation, same service calls)
```

Task schema (Pydantic `Schema`, source of the generated TS type):

```
task_id, title, notes, status, due, completed, updated, position,
task_list: {list_id, title}, is_starred, is_divider, task_order,
starred_order, labels: [{id, name}], is_archived, is_deleted,
needs_push
```

`needs_push` is exposed so the UI can show pending vs synced state.

Type generation:

```bash
python manage.py export_openapi_schema --api django_apps.api.api \
  > frontend/openapi.json          # ninja command
npm run gen:types --prefix frontend  # openapi-typescript → api-types.ts
```

Commit `openapi.json` and `api-types.ts`. A CI check regenerates both
and fails on diff, so backend and frontend can't drift silently.

## Rewrite strategy: staged, contract-first, strangler mount

Pushing to `main` deploys to Cloud Run **and** Vercel, so every merged
stage is live in prod. The new SPA therefore mounts at
**`/tasks/app/`** while the template UI keeps serving `/tasks/`.
Stage 6 swaps them. Each stage is one PR.

| Stage | Scope |
|---|---|
| 0. Shared API layer | Add `django-ninja`; `django_apps/api.py` (NinjaAPI, session auth + CSRF, 401/OAuth contract, error shape); `google_tasks/api.py` read endpoints + mutation operations + schemas; Django tests (auth 401, OAuth 401, per-user isolation, reorder payloads); `openapi.json` export |
| 1. Frontend platform | Root `frontend/` workspace (Vite multi-entry, TS strict, ESLint/Prettier, Vitest, `.nvmrc`); `shared/` client + NavBar/BurgerMenu; generated types; `django-vite` + `STATICFILES_DIRS`; `spa_shell` view at `/tasks/app/` (catch-all subroutes); Dockerfile node stage; `build_files.sh` npm lines; ignore files; frontend CI job; **Vercel manifest spike** (see below) |
| 2. Core dashboard | Task list, `<TaskCard>`, `<DividerCard>`, completed section, list/label/order filters (incl. client-side `secondary_label`), empty/auth states |
| 3. Mutations UI | Complete/uncomplete, star toggle, create/edit task modal, archive/delete/restore, burger menu actions |
| 4. Interactions | `dnd-kit` reorder, undo/redo store, autosync, divider create/edit/delete |
| 5. Secondary pages | Search, task detail, archived, trash — reuse Stage 2–3 components; Playwright smoke tests (load dashboard, complete a task, reorder, OAuth 401 bounce) |
| 6. Cutover | Route `/tasks/` → SPA shell, redirect `/tasks/app/*` → `/tasks/*`; delete templates, old JS/CSS, template render paths, `get_dashboard_js_config`, legacy mutation URLs; update READMEs/AGENTS.md; bump `PWA_CACHE_VERSION` |

Adding React to another app later (e.g. finance):

1. `finance/api.py` router → `api.add_router('/finance/', ...)`.
2. `frontend/src/finance/main.tsx` + add `finance` to Vite `input`.
3. `spa_shell(request, 'finance')` view under `/finance/app/`.
4. Regenerate types. No Docker/Vercel/CI changes.

## Infra delta (Stage 1 details)

### Dockerfile

```dockerfile
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci                      # cached unless deps change
COPY frontend/ ./
RUN npm run build               # tsc --noEmit && vite build
                                # → /frontend_dist (outDir ../)

FROM python:3.12-slim
# ... existing steps ...
COPY . .
COPY --from=frontend /frontend_dist /app/frontend_dist
# existing strict collectstatic block runs after this
```

`.dockerignore` additions: `node_modules`, `frontend/node_modules`,
`frontend_dist` (always built fresh in the node stage). The existing
`dist` entry is fine.

### Vercel (`build_files.sh`, before collectstatic)

```bash
npm ci --prefix frontend
npm run build --prefix frontend   # writes ../frontend_dist
```

`@vercel/static-build` runs in a Node image, so `npm` is available;
the Node version comes from `frontend/package.json` `engines` /
`.nvmrc`. Because `npm run build` runs `tsc --noEmit`, a type error
fails the Vercel build too — Vercel deploys don't go through GitHub
Actions, so this is its only gate.

### settings.py

```python
INSTALLED_APPS += ['django_vite']

STATICFILES_DIRS = [
    os.path.join(BASE_DIR, 'static'),
    os.path.join(BASE_DIR, 'frontend_dist'),
]

DJANGO_VITE = {
    'default': {
        'dev_mode': DEBUG and os.environ.get('VITE_DEV') == '1',
        'dev_server_port': 5173,
        'static_url_prefix': '',
        'manifest_path': os.path.join(
            BASE_DIR, 'frontend_dist', 'manifest.json'
        ),
    }
}
```

### Vercel manifest spike (must resolve in Stage 1)

On Vercel the Python lambda is bundled by `@vercel/python`,
separately from the `@vercel/static-build` step that runs
`build_files.sh`, and `frontend_dist/` is gitignored. It is therefore
**likely that `manifest.json` is not present inside the lambda**, and
`{% vite_asset %}` would fail at runtime there (Cloud Run is fine —
the file is in the image). Verify with a preview deploy before
building on it. Options, in order of preference:

1. **Confirm it works** (the file ends up in the lambda) — done.
2. **Ship the manifest with the Python code**: copy
   `manifest.json` to a path the lambda bundle includes (e.g.
   `django_apps/vite_manifest.json`, pulled in via the
   `@vercel/python` `includeFiles` config if the builders share a
   workspace) and point `manifest_path` at it. Verify it really lands
   in the lambda.
3. **Fixed entry names + version query**: `entryFileNames:
   '[name]/[name].js'`, shell template appends
   `?v=<VERCEL_GIT_COMMIT_SHA or image SHA build arg>`. Chunks keep
   content hashes. Loses django-vite's prod manifest lookup but
   keeps dev HMR.

Record the outcome in this doc and in root `AGENTS.md`.

### Ignore files

- `.gitignore`: `node_modules/`, `frontend_dist/`,
  `frontend/test-results/`, `frontend/playwright-report/`.
- `.vercelignore` (new): `node_modules`, `frontend_dist`, `venv`,
  `terraform`. Note this only filters **uploaded source**, not build
  output — check lambda size against `maxLambdaSize: 15mb` after the
  first preview deploy.

### CI (`.github/workflows/frontend.yml`, new)

Runs on PRs and on `main` for paths `frontend/**`, `*/api.py`,
`django_apps/api.py`:

1. `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`
   (Vitest).
2. Export OpenAPI + regenerate types → `git diff --exit-code`.
3. Playwright smoke tests from Stage 5 onward (against
   `runserver` with the sqlite fallback settings + a seeded user).

`deploy.yml` needs no change (the Docker node stage builds and
type-checks); optionally add `needs:` on the frontend job to block
Cloud Run deploys on failing tests.

### Dev loop

```bash
# terminal 1
python manage.py runserver            # :8000 (runsslserver for OAuth)
# terminal 2
VITE_DEV=1 npm run dev --prefix frontend   # :5173
```

Open `http://localhost:5173/tasks/app/`. Vite proxies everything that
isn't a Vite asset to Django, so the session cookie, CSRF cookie and
shell template all work same-origin. The shell renders
`{% vite_asset %}` in dev mode → HMR.

### PWA

- `spa_shell.html` includes `pwa/head.html`, so the service worker and
  manifest are still registered.
- Add `/api/` to `BYPASS_PATHS` in `pwa/sw.js` — API responses must
  never be served from the SW cache.
- Navigations under `/tasks/app/*` are network-first and cached like
  other pages; the offline fallback serves the cached shell, which
  then fails API calls. Show an "offline" state in the UI from
  TanStack Query's network errors rather than a blank page.
- Bump `PWA_CACHE_VERSION` in Stage 1 and again at cutover.

## Key choices

- **Shared root `frontend/`, multi-entry** — one toolchain, shared
  deps and `shared/` code; new apps cost one folder.
- **django-ninja** — function-based, Pydantic validation, OpenAPI for
  free; replaces hand-written serializers per app.
- **Generated TS types** — the contract is enforced by CI, not by
  convention.
- **django-vite** — standard Django↔Vite glue, dev HMR + prod
  manifest, multi-entry aware.
- **TanStack Query** for server state — tasks are server-owned state
  with sync semantics; replaces the hand-rolled cache/invalidation
  that `action_history.js` approximates.
- **dnd-kit** over SortableJS — React-native drag/drop, same float
  midpoint `task_order`/`starred_order` payload.
- **Bootstrap 5 via npm** in `shared/` for visual parity with the
  template pages (which keep using the CDN); swapping design systems
  is a separate decision.
- Show `needs_push` (pending/synced) state in the UI.

## Risks / gotchas

- OAuth redirects inside `fetch`: never `fetch` an endpoint that
  returns Google redirects and follow it — the API returns 401 + URL,
  the client navigates.
- Vercel manifest availability — see spike above; don't start Stage 2
  until it's resolved.
- Vercel lambda timeout on sync-heavy calls — unchanged from today,
  but React will make more granular calls; keep sync as one POST.
- More granular calls also mean more DB connections on Vercel
  (`CONN_MAX_AGE=0`). Keep read endpoints to one call per page; watch
  for Aiven `max_connections` errors (see root `AGENTS.md`).
- `secondary_label` filtering is currently client-side — replicate
  in React state, not new API params.
- Two-phase reorder constraint handling stays server-side; the React
  layer just sends `{task_id: position}` payloads as today.
- Per-user isolation: every ninja operation filters by
  `request.user` / `get_object_or_404(..., user=request.user)`; cover
  with tests in Stage 0.
- Both UIs are live between Stage 1 and 6 on the same data — mutation
  semantics must stay identical (same service functions), so
  switching between `/tasks/` and `/tasks/app/` is safe.
