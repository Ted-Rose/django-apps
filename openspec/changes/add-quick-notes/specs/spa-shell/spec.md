# Spec Delta

## MODIFIED Requirements

### Requirement: One slug everywhere

Each SPA SHALL use a single slug consistently as: the folder
under `frontend/src/<entry>/`, the vite input key in
`frontend/vite.config.ts`, the `api.add_router('/<entry>/')`
prefix, and the app's URL prefix. Current entries: `tasks`,
`finance`, `gmail`, `single_pages`, `notes`. Adding an SPA MUST
wire all four places with the same slug; `single_pages` is
exempt from the URL-prefix leg (deliberate root mount).

#### Scenario: Entry folder equals vite input equals API prefix

- **WHEN** the `tasks` SPA calls its backend
- **THEN** it fetches `/api/tasks/…`, its bundle was built from
  `src/tasks/main.tsx` via the `tasks` vite input, and its
  pages live under `/tasks/`

#### Scenario: single_pages mounts at root with two page paths

- **WHEN** the `single_pages` SPA serves pages
- **THEN** they are `/twister` and `/spoki/` — no
  `/single_pages/` page prefix exists (a root catch-all would
  shadow every later include); the slug still holds for the
  folder, vite input, and `/api/single_pages/` mount

#### Scenario: API 401s send users back to the SPA page

- **WHEN** `spa_url_for` maps `/api/<app>/<sub>` for a `next`
  or `login_url` parameter
- **THEN** the result is the SPA page path
  (`/api/tasks/trash/?x` → `/tasks/trash/?x`), never a raw
  `/api/` JSON URL — apps in `SPA_BASES` collapse to their
  single page (`/api/gmail/…` → `/gmail/…`) and `dashboard`
  subpaths collapse to the app root
