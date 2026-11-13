# Spec Delta

## MODIFIED Requirements

### Requirement: Shared shell rendering

SPA pages SHALL be served by `spa_shell`, which renders
`spa_shell.html` for `vite_entry = src/shell/main.tsx` — one
shell entry for every app mount. The shell MUST be public (no
`@login_required`, no `@ensure_csrf_cookie`) and byte-identical
for all users: no per-user content, no `Set-Cookie`, and a
`Cache-Control: public, s-maxage=…` header so edge caches can
hold it. The `#spa-bootstrap` json_script SHALL embed only
user-agnostic deployment config (Sentry DSN/environment/
release); per-user context is fetched asynchronously via the
bootstrap endpoint. The `entry` MUST match `[a-z0-9_]+`; in
production a missing manifest/entry key degrades to a
diagnostic page, not a 500.

#### Scenario: Anonymous user is bounced to login

- **WHEN** an unauthenticated user requests an SPA page
- **THEN** the response is a 200 with the same shell HTML an
  authenticated user receives, and after the bootstrap
  endpoint 401s the client navigates to the login URL —
  the bounce survives, moved client-side

#### Scenario: Bootstrap payload is embedded for the SPA

- **WHEN** any user requests an SPA page
- **THEN** the rendered HTML contains a `#spa-bootstrap`
  json_script carrying only `sentry` config (DSN, environment,
  release) — `user` and `language` arrive via the bootstrap
  endpoint instead

#### Scenario: Shell response is edge-cacheable

- **WHEN** the shell renders for any user
- **THEN** the response carries `Cache-Control: public,
  s-maxage=<seconds>` and sets no cookies, so identical bytes
  can be served to every user from an edge cache

#### Scenario: Malformed entry name is rejected

- **WHEN** `spa_shell` receives an `entry` that does not match
  `[a-z0-9_]+`
- **THEN** it raises Http404 instead of resolving a vite asset

#### Scenario: Stale build degrades instead of crashing

- **WHEN** `manifest.json` is missing or lacks the entry key in
  production (`VITE_DEV` off, where the manifest is consulted)
- **THEN** the shell renders a diagnostic page (`manifest_ready`
  false) rather than raising `DjangoViteAssetNotFoundError`

### Requirement: react_app mount semantics

`react_app(request, title, subpath)` SHALL be the app-level
mount, bound via `functools.partial` in `urls.py` (tasks, gmail,
single_pages, notes) or via a thin wrapper view (finance's
`finance_app`, which delegates to `react_app`). Every mount
serves the unified `shell` entry — per-app `entry` binding is
gone. Every GET/HEAD path under the mount renders the shell and
React Router resolves the page client-side; `subpath` catch-alls
are intentionally unused. Non-GET/HEAD requests MUST 404 —
mutations live only under `/api/`.

#### Scenario: Deep link renders the shell

- **WHEN** a user GETs a client-side route under an SPA mount
  (e.g. `/tasks/trash/`)
- **THEN** the same `spa_shell` HTML is served

#### Scenario: Form POST to a page URL is rejected

- **WHEN** a non-GET/HEAD request hits an SPA mount path
- **THEN** the response is 404, never the HTML shell

### Requirement: One slug everywhere

Each SPA SHALL use a single slug consistently as: the folder
under `frontend/src/<entry>/` (the lazy chunk root), the
`api.add_router('/<entry>/')` prefix, and the app's URL prefix.
There is exactly one Vite input — `shell` — shared by all apps;
per-app Vite inputs do not exist. Current app slugs: `tasks`,
`finance`, `gmail`, `single_pages`, `notes`. Adding an SPA MUST
wire the folder, API prefix, URL prefix, and the shell route
table with the same slug; `single_pages` is exempt from the
URL-prefix leg (deliberate root mount).

#### Scenario: Entry folder equals vite input equals API prefix

- **WHEN** the `tasks` SPA calls its backend
- **THEN** it fetches `/api/tasks/…`, its code lives in
  `src/tasks/` and reaches the browser through the shared
  `shell` vite input, and its pages live under `/tasks/`

#### Scenario: single_pages mounts at root with two page paths

- **WHEN** the `single_pages` SPA serves pages
- **THEN** they are `/twister` and `/spoki/` — no
  `/single_pages/` page prefix exists (a root catch-all would
  shadow every later include); the slug still holds for the
  folder and the `/api/single_pages/` mount

#### Scenario: API 401s send users back to the SPA page

- **WHEN** `spa_url_for` maps `/api/<app>/<sub>` for a `next`
  or `login_url` parameter
- **THEN** the result is the SPA page path
  (`/api/tasks/trash/?x` → `/tasks/trash/?x`), never a raw
  `/api/` JSON URL — apps in `SPA_BASES` collapse to their
  single page (`/api/gmail/…` → `/gmail/…`) and `dashboard`
  subpaths collapse to the app root
