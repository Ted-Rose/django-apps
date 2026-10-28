# Sentry integration — django-apps

Status: implemented — Sentry provisioning DONE 2026-10-28.
  Org `django-apps-ted` (EU, de.sentry.io) holds
  `django-apps-api` + `django-apps-web` with DSNs, web inbound
  filters, org data-scrubbing and production level:error email
  workflows. Key rate-limit calls no-op on this org (the
  `rate-limits` feature isn't enabled on new-org plans).
  `env-file` secret in `django-apps-7345` carries the EU DSNs
  (version 3), live at next deploy. Code changes below
  implemented on `feat/sentry-integration`.
Date: 2026-10-28
Standard: `Bible Research/docs/plans/sentry-integration-standard.md`
Reviewed-by: independent repo audit 2026-10-28 — corrections
  folded in (ninja re-raise semantics, `/login/` scrub path,
  DOM-level bootstrap read, run_all_jobs wiring).

## What this is

Add DSN-gated Sentry monitoring to this repo's deployables,
following the workspace playbook. One Django 4.2 monolith serving
its own Vite SPAs via django-vite + `spa_shell`, deployed to:

- GCP Cloud Run — `django-apps` service + `all-jobs` job
  (project `django-apps-7345`, region `europe-west3`).
- Vercel — `tedisrozenfelds.vercel.app`, `@vercel/python` WSGI
  function + `@vercel/static-build` for staticfiles; deploys via
  the GitHub integration. Preview deploys already fail (env vars
  are Production-scoped) — no preview coverage needed.
- Cloud Run PR preview services (`deploy-pr-preview.yml`,
  dispatch-only) — share `env-file`, must set
  `SENTRY_ENVIRONMENT=preview` or they pollute the prod queue.

Sentry org: **`django-apps-ted`** (EU, de.sentry.io — one org per
product; `django-apps` slug is taken by another Sentry customer).
Projects:

- `django-apps-api` — platform `python-django`.
- `django-apps-web` — platform `javascript-react`.

Environment tag: `SENTRY_ENVIRONMENT` (explicit override) →
`VERCEL_ENV` ('production' | 'preview') → `production` when
`K_SERVICE` is set (Cloud Run service AND jobs) → `development`.
Release: `K_REVISION` → `VERCEL_GIT_COMMIT_SHA` → unset locally.

## Provisioning (Sentry REST API)

DONE 2026-10-28 — recorded for repeatability. Org
`django-apps-ted` was created by the user in the Sentry web UI
(EU region picker — the API only creates US orgs); team slug
`django-apps-ted`. Token:
`source ~/.config/devin/sentry.env` (SENTRY_API_TOKEN).

```bash
BASE="https://de.sentry.io/api/0"
AUTH="Authorization: Bearer $SENTRY_API_TOKEN"
ORG="django-apps-ted"; TEAM="django-apps-ted"

for spec in "django-apps-api:python-django" \
            "django-apps-web:javascript-react"; do
  name="${spec%%:*}"; platform="${spec##*:}"
  curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$name\",\"platform\":\"$platform\"}" \
    "$BASE/teams/$ORG/$TEAM/projects/"
done
curl -s -H "$AUTH" "$BASE/projects/$ORG/django-apps-api/keys/"
curl -s -H "$AUTH" "$BASE/projects/$ORG/django-apps-web/keys/"
# → record each DSN

# DSN abuse protection (NESTED object — flat fields silently no-op):
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"rateLimit":{"window":3600,"count":100}}' \
  "$BASE/projects/$ORG/django-apps-web/keys/<key_id>/"
# ...repeat for the api key

# Web inbound filters (api project: leave web-noise filters OFF):
for f in browser-extensions web-crawlers legacy-browsers localhost; do
  curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
    -d '{"active":true}' \
    "$BASE/projects/$ORG/django-apps-web/filters/$f/"
done

# Org-level scrubbing (replicate the bible-research settings):
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"dataScrubber":true,"sensitiveFields":["password","token",
  "authorization","api_key","secret","access_token",
  "refresh_token","session","csrftoken"]}' \
  "$BASE/organizations/$ORG/"

# Alert: POST $BASE/organizations/$ORG/workflows/ — triggers
# first_seen_event + regression_event (each with
# "conditionResult":true); actionFilters logic "all" with two
# tagged_event conditions (environment eq production, level eq
# error); action type "email" / targetType "issue_owners";
# config {"frequency":30}; detectorIds=[<project's auto-created
# "Issue Stream" detector id from GET $BASE/organizations/$ORG/
# detectors/>]. Verified working payload on 2026-10-28.
```

Note: key `rateLimit` PUTs silently no-op on this org (the
`rate-limits` feature isn't enabled on new-org plans) — the
calls above are recorded for when the feature lands.

## Secret wiring (zero build plumbing)

The SPA is server-rendered, so the web DSN ships inside the
existing `spa-bootstrap` json_script at request time — no vite
env vars, no Docker build args, no Vercel `VITE_*` vars. DSNs are
public client keys; the rate limit + inbound filters bound abuse.

- Cloud Run (service + `all-jobs` job share the secret; terraform
  `cloud_run.tf`/`cloud_run_jobs.tf` mount `DOTENV=env-file`):
  append/replace the two lines in the `env-file` secret payload
  in `django-apps-7345`:

  ```bash
  gcloud secrets versions access latest --secret=env-file \
    --project=django-apps-7345 > /tmp/env-file
  # replace the SENTRY_DSN=/SENTRY_WEB_DSN= lines added
  # 2026-10-28 (they hold the parked projects' DSNs)
  gcloud secrets versions add env-file \
    --project=django-apps-7345 --data-file=/tmp/env-file
  ```

  Takes effect at the next deploy/revision — env changes alone
  do not restart the service.
- Vercel project env vars: `SENTRY_DSN`, `SENTRY_WEB_DSN`
  (Production scope — dashboard or REST API; no vercel CLI here).
- Local `.env`: both lines present and EMPTY (added 2026-10-28).
- `.env.example`: add both keys (commented/empty) — committed doc.
- `deploy-pr-preview.yml`: add `SENTRY_ENVIRONMENT=preview` to the
  existing `--set-env-vars` flag (line ~87) so dispatch previews
  report `environment:preview`.

## Backend changes

- `requirements.txt`: pin `sentry-sdk` (bible_research uses
  `sentry-sdk==2.73.0`).
- New `django_apps/sentry.py` (mirror
  `bible_research/bible_research/utils.py` +
  `bible/utils/provider_errors.py`):
  - `sentry_before_send` — strip `request.data` on credential
    paths: `/login/` (the real credential POST — `LOGIN_URL`,
    google_api) and `/admin/` (admin login posts passwords);
    guard non-dict `request`.
  - `capture_internal_exception(exc)` — `new_scope()`, tag
    `error_code:internal_error`, `capture_exception` level error;
    no-ops when uninitialized.
- `django_apps/settings.py` (after env loading): read
  `SENTRY_DSN`/`SENTRY_WEB_DSN`/`SENTRY_ENVIRONMENT` via
  `os.environ` — covers the cloud branch, the dotenv branch AND
  the config.yaml fallback. `if SENTRY_DSN: sentry_sdk.init(...)`
  — `DjangoIntegration()`, `LoggingIntegration(level=
  logging.INFO, event_level=None)` (**add `import logging`** —
  not imported today), breadcrumbs only never events,
  `send_default_pii=False`, `before_send`, `environment`,
  `release=os.environ.get('K_REVISION') or
  os.environ.get('VERCEL_GIT_COMMIT_SHA')`,
  `traces_sample_rate=0.1`.
- `django_apps/api.py` — add `@api.exception_handler(Exception)`
  → `capture_internal_exception` + uniform
  `{error:'server_error', detail:'Internal Server Error'}` 500.
  Corrected rationale: django-ninja 1.7.1 RE-RAISES unhandled
  exceptions under `DEBUG=False`, so they already reach
  `DjangoIntegration` today — the handler buys the uniform JSON
  body + the `internal_error` tag (and once it exists,
  `got_request_exception` no longer fires for API ops, so
  capture then depends solely on `capture_internal_exception`).
- `django_apps/views.py` `spa_shell`: add to `bootstrap` —
  `'sentry': {'dsn': settings.SENTRY_WEB_DSN, 'environment': ...,
  'release': ...}` (compute once in settings).
- `django_apps/management/commands/run_all_jobs.py` (~line 132):
  the `(Exception, SystemExit)` catch must call
  `capture_internal_exception` — the `all-jobs` Cloud Run job is
  the highest-value `internal_error` source (job crashes have no
  request context, but `capture_exception` works fine outside
  requests). Sub-commands that swallow their own exceptions get
  the same call.
- `settings.py` CORS: add `'sentry-trace'` + `'baggage'` to
  `CORS_ALLOW_HEADERS` — `reactive-bible.vercel.app` is already an
  allowed cross-origin origin and its tracing headers are
  currently dropped by the default header safelist.

## Frontend changes

- `frontend/`: `npm i @sentry/react` (bible uses `^11.9.0`).
  `@sentry/vite-plugin` optional — skip sourcemap upload in v1.
- `frontend/src/shared/sentry.ts`: `initSentry()` — read
  `dsn/environment/release` from the `#spa-bootstrap` DOM node
  DIRECTLY (`document.getElementById('spa-bootstrap')` +
  `JSON.parse` — `useBootstrap` is a React hook and can't run
  before `createRoot`); also honor
  `import.meta.env.VITE_SENTRY_DSN` as an override. No DSN → no
  init. `browserTracingIntegration` + `replayIntegration(
  {maskAllText, blockAllMedia})`; `replaysSessionSampleRate:0`,
  `replaysOnErrorSampleRate:1.0`, `tracesSampleRate:0.1`,
  `tracePropagationTargets:[location.origin]`.
  `beforeSend` drop list: `AbortError` (Error OR DOMException),
  `ChunkLoadError`/`Loading chunk \d+ failed`/`Loading CSS chunk`
  (match `event.message` + `exception.values[0].value` — the
  GlobalHandlers onerror path is message-only), `ResizeObserver
  loop`; `TypeError` network failures tagged `errorKind:network`,
  not dropped. Re-apply `context` on `onunhandledrejection`
  (Dedupe keeps the GlobalHandlers copy).
- `frontend/src/shared/errorReporter.ts` + `ErrorBoundary.tsx`
  (port `reactive-bible/src/utils/errorReporter.tsx`, adapt the
  notification to `shared/toasts.ts`): window `error` +
  `unhandledrejection`; resource-load → `captureMessage` warning,
  tag `reportType:resource-load`, query string stripped, deduped
  per URL.
- Each `src/<entry>/main.tsx` (tasks, finance, gmail,
  single_pages): `initSentry()` + `initGlobalErrorHandlers()`
  before `createRoot`; `<ErrorBoundary>` around `<App/>`.
- Coverage caveat: non-SPA pages (`/`, `/login/`, `/offline/`,
  Django admin, `home.html`) get no web-SDK coverage — accepted.
- PWA service worker (`pwa/sw.js`, stale-while-revalidates
  `/static/`): may surface extra resource-load warnings — handled
  by the warning stream; Sentry ingest is cross-origin and
  unaffected.

## Event-stream contract (document in AGENTS.md)

`is:unresolved level:error environment:production` = agent-fixable
bugs only:

| Stream | Transport | Level | Tag |
|---|---|---|---|
| Unhandled 500s | DjangoIntegration | error | — |
| Caught API/job bugs | capture_internal_exception | error |
  `error_code:internal_error` |
| Browser exceptions | captureException | error | — |
| Resource loads | captureMessage | warning |
  `reportType:resource-load` |

Logs are breadcrumbs only (`event_level=None`). No user-report or
provider-outage streams yet — GoCardless sync failures are the
natural `error_code:provider_error` candidate if added later.

## Verification

- `python manage.py check` + `manage.py test <app>`; frontend
  `npm run typecheck && npm test` (port a `sentry.test.ts` for the
  beforeSend list). No OpenAPI/api-types drift — exception
  handlers don't change the schema; CI gates stay green.
- No DSN → all capture calls no-op (assert in a test).
- After deploy: `GET .../django-apps-api/issues/` shows a real
  event; the SPA `spa-bootstrap` JSON carries `sentry.dsn`.
- Phase 2: port `.devin/skills/fix-sentry-issue-*` from Bible
  Research adapted to this repo's queues.
