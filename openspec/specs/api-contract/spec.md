# API Contract Specification

## Purpose

Defines the contract on the shared django-ninja layer every React
SPA consumes: one `NinjaAPI` mounted at `/api/`, session auth with
CSRF, the uniform `{error, detail}` failure envelope, the 401
auth-navigation payloads (`login_url` / `authorization_url`), and
the obligations the shared frontend client
(`frontend/src/shared/api/client.ts`) fulfills against them. This
is the backend-frontend seam — both sides MUST stay in sync.

## Requirements

### Requirement: Single shared API mount

There SHALL be exactly one `NinjaAPI` instance, defined in
`django_apps/api.py` and mounted at `/api/` in
`django_apps/urls.py`. Each app SHALL register a `Router` from
`<app>/api.py` via `api.add_router('/<entry>/', …)` matching the
app's SPA slug; project-level routers (`django_apps/me.py`)
register here too. The API
MUST authenticate via ninja `django_auth` (session cookie plus
CSRF on unsafe methods) and MUST return JSON errors — never HTML
login redirects.

#### Scenario: App router is reachable under its entry slug

- **WHEN** a request hits `/api/tasks/…` (or `gmail`, `finance`,
  `single_pages`, `me`)
- **THEN** the corresponding app's ninja router handles it

#### Scenario: API failures never redirect to a login page

- **WHEN** authentication fails on any `/api/` endpoint
- **THEN** the response is a JSON 401, not a 302 to a login page

### Requirement: Uniform error envelope

API failures SHALL return `{error: <status-slug>, detail}` where
`error` is the machine-readable slug for the HTTP status
(`bad_request`, `unauthenticated`, `forbidden`, `not_found`,
`method_not_allowed`, `conflict`, `validation_error`,
`throttled`, `server_error`, `upstream_error`; unmapped statuses
fall back to `error`). `ApiHttpError` MAY add `code` + `params`
— an i18n slug resolved by the SPA's `server` catalog namespace
with `detail` as the English fallback.

#### Scenario: Missing resource returns not_found slug

- **WHEN** an endpoint raises `Http404`
- **THEN** the API responds 404 with `{error: 'not_found',
  detail}`

#### Scenario: Schema validation failure returns validation_error

- **WHEN** request data fails ninja schema validation
- **THEN** the API responds 422 with `{error: 'validation_error',
  detail: <error list>}` (not ninja's bare `{detail}` shape)

#### Scenario: Unhandled exception returns generic server_error

- **WHEN** an endpoint raises an unhandled exception
- **THEN** the API responds 500 with `{error: 'server_error',
  detail: 'Internal Server Error'}` and reports the exception to
  Sentry via `capture_internal_exception` (tag
  `error_code:internal_error`) — `str(exc)` MUST NOT leak into
  the body

#### Scenario: Endpoints can attach an i18n code

- **WHEN** an endpoint raises `ApiHttpError(status, message,
  code='some_slug', params={…})`
- **THEN** the body carries `error` (status slug), `detail`,
  `code`, and `params` so `errorDetail()` can localize it

### Requirement: Auth-failure navigation contract

The API SHALL signal two distinct 401 auth failures the SPA
navigates on itself: `unauthenticated` (session) with a
`login_url`, and `google_reauth` (dead Google credentials) with
an `authorization_url`. Auth navigation MUST return the user to
an SPA page — carried in the `/login/` `next` param (built via
`spa_url_for`) or `session['oauth_redirect_url']` — never a
raw `/api/` JSON URL.

#### Scenario: Expired session yields login_url 401

- **WHEN** a request arrives without a valid session
- **THEN** the API responds 401 with `{error: 'unauthenticated',
  login_url: '/admin/login/?next=<spa page>'}`

#### Scenario: Dead Google credentials yield google_reauth 401

- **WHEN** an endpoint needs Google credentials that are missing
  or expired — raised via `GoogleReauthRequired` or produced by
  `_adapt()` from legacy `{'reauth_required': …}` /
  `{'error': 'No credentials found'}` payloads
- **THEN** the API responds 401 with `{error: 'google_reauth',
  authorization_url}` pointing into the OAuth flow

#### Scenario: Google consent URL returns via the session

- **WHEN** `_adapt()` passes through a payload
  `authorization_url` — a Google consent URL built by
  `flow.authorization_url`, carrying `state`/`redirect_uri`
  but no `next`
- **THEN** the SPA page the user returns to lives in
  `session['oauth_redirect_url']` (a `spa_url_for` path or an
  SPA URL name like `google_tasks:dashboard`), not an `/api/`
  URL

#### Scenario: Legacy view failure payload is adapted

- **WHEN** a delegated mutation view returns
  `JsonResponse({'success': False, …})`
- **THEN** `_adapt` rewrites it to the uniform `{error, detail}`
  envelope, flooring a sub-400 status at 500

### Requirement: SPA client obligations

The shared client `apiFetch` SHALL send cookies same-origin,
set `X-CSRFToken` on unsafe methods, and fetch with
`redirect: 'manual'` so auth redirects are never followed by
XHR. Auth-failure 401s SHALL trigger page navigation; other
non-2xx responses SHALL throw a typed `ApiError`.

#### Scenario: 401 with authorization_url navigates away

- **WHEN** any API call returns 401 whose body carries
  `authorization_url` or `login_url`
- **THEN** the client navigates the browser to that URL and the
  caller's promise never resolves

#### Scenario: Opaque redirect bounces to login

- **WHEN** `redirect: 'manual'` surfaces an opaque-redirect stub
  (status 0 — session expiry on non-ninja endpoints, middleware
  redirects)
- **THEN** the client navigates to
  `/admin/login/?next=<current path>`

#### Scenario: Unsafe request carries the CSRF header

- **WHEN** the client issues a POST/PUT/PATCH/DELETE
- **THEN** the request includes `X-CSRFToken` read from the
  `csrftoken` cookie

#### Scenario: Coded error body renders localized text

- **WHEN** an `ApiError` body carries `code` + `params`
- **THEN** `errorDetail()` returns the `server:`-namespaced
  translation, falling back to English `detail` when unmapped
