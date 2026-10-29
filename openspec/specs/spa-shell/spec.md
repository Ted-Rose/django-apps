# SPA Shell Specification

## Purpose

Defines how the React single-page apps are served by Django: the
shared `spa_shell`/`react_app` views in `django_apps/views.py`,
the one-slug-everywhere mount convention, the `SPA_BASES` /
`spa_url_for` mapping that turns API URLs back into SPA pages for
auth `next` parameters, and the `app_redirect` legacy-path
redirects.

## Requirements

### Requirement: Shared shell rendering

SPA pages SHALL be served by `spa_shell` (`@login_required` +
`@ensure_csrf_cookie`), which renders `spa_shell.html` for
`vite_entry = src/<entry>/main.tsx` and embeds a `#spa-bootstrap`
json_script. The `entry` MUST match `[a-z0-9_]+`; in production a
missing manifest/entry key degrades to a diagnostic page, not a
500.

#### Scenario: Anonymous user is bounced to login

- **WHEN** an unauthenticated user requests an SPA page
- **THEN** Django redirects to the login page (HTML flow, not a
  JSON 401)

#### Scenario: Bootstrap payload is embedded for the SPA

- **WHEN** an authenticated user requests an SPA page
- **THEN** the rendered HTML contains a `#spa-bootstrap`
  json_script with `user`, `language`, and `sentry` config
  (DSN, environment, release)

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

`react_app(request, entry, title, subpath)` SHALL be the
app-level mount, bound via `functools.partial` in `urls.py`
(tasks, gmail, single_pages) or via a thin wrapper view
(finance's `finance_app`, which delegates to `react_app`).
Every GET/HEAD path under the mount renders the shell and React
Router resolves the page client-side; `subpath` catch-alls are
intentionally unused. Non-GET/HEAD requests MUST 404 — mutations
live only under `/api/`.

#### Scenario: Deep link renders the shell

- **WHEN** a user GETs a client-side route under an SPA mount
  (e.g. `/tasks/trash/`)
- **THEN** the same `spa_shell` HTML is served

#### Scenario: Form POST to a page URL is rejected

- **WHEN** a non-GET/HEAD request hits an SPA mount path
- **THEN** the response is 404, never the HTML shell

### Requirement: One slug everywhere

Each SPA SHALL use a single slug consistently as: the folder
under `frontend/src/<entry>/`, the vite input key in
`frontend/vite.config.ts`, the `api.add_router('/<entry>/')`
prefix, and the app's URL prefix. Current entries: `tasks`,
`finance`, `gmail`, `single_pages`. Adding an SPA MUST wire all
four places with the same slug.

#### Scenario: Entry folder equals vite input equals API prefix

- **WHEN** the `tasks` SPA calls its backend
- **THEN** it fetches `/api/tasks/…`, its bundle was built from
  `src/tasks/main.tsx` via the `tasks` vite input, and its pages
  live under `/tasks/`

#### Scenario: API 401s send users back to the SPA page

- **WHEN** `spa_url_for` maps `/api/<app>/<sub>` for a `next` or
  `login_url` parameter
- **THEN** the result is the SPA page path (`/api/tasks/trash/?x`
  → `/tasks/trash/?x`), never a raw `/api/` JSON URL — apps in
  `SPA_BASES` collapse to their single page (`/api/gmail/…` →
  `/gmail/…`) and `dashboard` subpaths collapse to the app root

### Requirement: Legacy app-path redirects

`app_redirect` SHALL permanently redirect `/<base>/app/<subpath>`
to `/<base>/<subpath>`, preserving the query string, and MUST NOT
require login (the destination page bounces anonymous users,
avoiding a double hop).

#### Scenario: Strangler-mount URL is preserved

- **WHEN** a user follows an old link like `/tasks/app/trash/?q=1`
- **THEN** the response is a 301 to `/tasks/trash/?q=1`
