# Vercel configuration — what to set and why

Where: **Vercel dashboard → `django-apps` project → Settings →
Environment Variables**. Changes require a redeploy to take effect
(Deployments → ⋯ → Redeploy).

No `vercel.json` changes are needed for the finance React SPA —
Django's `<path:subpath>` catch-all already serves the shell on every
`/finance/*` deep link, and `/static/*` still routes to the CDN.

## Environment variables

### One variable covers everything: `DOTENV`

The recommended setup is a **single `DOTENV` env var** holding the
full contents of the repo-root `.env` file (same KEY=VALUE format
the GCP `env-file` secret uses — `.env.example` documents every
key). `settings.py` parses `DOTENV` at import, so the per-key list
below is what that blob must contain; setting them individually
also works and real env vars always win over `DOTENV` entries.

### Runtime (used by the serverless function)

- `DJANGO_SECRET_KEY` — same as Cloud Run's `django-secret-key`;
  copy from GCP Secret Manager or local `config.yaml` →
  `SECRET_KEY`.
- `APP_BASE_URL` — `https://<your-vercel-domain>` (e.g.
  `https://tedis.vercel.app`). **Must match the host
  serving the traffic.** GoCardless bakes
  `{BASE_URL}/finance/callback/` into the requisition; if a user
  starts Connect Bank on Vercel but `APP_BASE_URL` points at Cloud
  Run, the callback lands there and the session cookie is gone →
  "No pending bank connection found."
- `DATABASE_URL` — Aiven Postgres URL, e.g.
  `postgres://user:pass@host:port/db?sslmode=verify-full&
  sslrootcert=ca.pem`. Same DB as Cloud Run. `sslmode` defaults to
  `require` if unset; `verify-full` needs the CA cert — provide it
  via `DB_SSL_CERT` (below; legacy `capem` works too) and
  `settings.py` writes it to
  `/tmp/ca.pem` at runtime and points `sslrootcert` there, so a
  relative `sslrootcert=ca.pem` in the URL no longer depends on
  the build bundling the file into `/var/task`.
  `CONN_MAX_AGE=0` is automatic on Vercel — keep it that way to
  protect Aiven's `max_connections`.
- `DB_SSL_CERT` — full PEM text of the Aiven project CA
  certificate (same value as the local `ca.pem` file, `\n`-escaped
  inside double quotes in dotenv format). Required when
  `DATABASE_URL` uses `sslmode=verify-full`.
- `GOOGLE_OAUTH_CLIENT_JSON` — full contents of
  `google_api/app_secrets.json`; written to
  `/tmp/app_secrets.json` at settings import.
- `GOCARDLESS_SECRET_ID` — GoCardless Bank Account Data secret id;
  finance — same value as Cloud Run.
- `GOCARDLESS_SECRET_KEY` — GoCardless Bank Account Data secret
  key; finance — same value as Cloud Run.
- `VAPID_PUBLIC_KEY` — same as Cloud Run. **Must be identical on
  both deploys** — `PushSubscription` rows are shared via the DB;
  mismatched keys break pushes for browsers that subscribed on the
  other deploy.
- `VAPID_PRIVATE_KEY` — same as Cloud Run.
- `VAPID_SUBJECT` — `mailto:<your-email>`; required by Web Push
  (contact URI).
- `GCS_AUDIO_BUCKET` — `django-apps-7345-audio-recordings`;
  required for `/api/gmail/audio/` and `/api/single_pages/tts/` on
  Vercel — without it `text_to_audio` fails with 'GCS storage not
  configured'.
- `GCP_SERVICE_ACCOUNT_JSON` —
  `terraform output -raw vercel_audio_sa_key_json`; required for
  the same audio endpoints — Vercel lambdas have no GCP metadata
  server, so `google.auth.default()` needs this `vercel-audio` SA
  key (written to `/tmp/gcp_service_account.json` at settings
  import). Without it the endpoints 502.
- `SENTRY_DSN` / `SENTRY_WEB_DSN` — error monitoring for the
  backend (`django-apps-api` project) and SPA (`django-apps-web`)
  in org `django-apps-ted` on de.sentry.io. Copy both from the GCP
  `env-file` secret. Empty/absent is a safe no-op; set both to
  get Vercel-side coverage.

`VERCEL=1` is injected by Vercel automatically (build + runtime) — do
not set it manually; it's what puts `settings.py` into cloud mode.

### Build time (consumed by `build_files.sh`)

- `capem` / `DB_SSL_CERT` — PEM text of the Aiven project CA
  certificate; parsed and written to `ca.pem` during build.
  Legacy: runtime now materializes `DB_SSL_CERT` to `/tmp/ca.pem`
  itself, so this is only belt-and-braces for `sslrootcert=ca.pem`
  relative-path lookups.
- `config_yaml` — YAML text of `config.yaml`, written to
  `config.yaml` during build. Effectively redundant while
  `VERCEL=1` is set (cloud env vars take precedence), but the
  build script still generates it — keep it in sync if you set
  it.

## Scope settings

Set every variable above to the **Production** environment (that's
what live traffic uses). This is also why **preview deployments
currently fail**: the vars are Production-scoped, so preview builds
run `collectstatic` without them. (Migrations never run in the
Vercel build — `deploy.yml` owns `manage.py migrate`.)

To fix previews (optional): add the same variables with the
**Preview** scope too — either point them at the same Aiven DB
(simplest, but shares `max_connections` with prod) or a scratch
database.

## Post-deploy dashboard checklist

1. Settings → Environment Variables: add `DOTENV` = the repo-root
   `.env` contents (covers every runtime var above), scoped to
   **Production** (and Preview if you want preview deploys — see
   "Scope settings").
2. Set `SENTRY_DSN` + `SENTRY_WEB_DSN` inside that blob — unset
   means no error reporting from the Vercel deploy.
3. Settings → Functions: enable **Fluid compute** and confirm the
   region shows `fra1` (pinned by `vercel.json`'s `regions`).
4. `APP_BASE_URL` = the Vercel domain (with `https://`, no trailing
   slash). If you attach a custom domain, also add it to
   `ALLOWED_HOSTS` in `django_apps/settings.py` (currently
   `.vercel.app` + `tedis.vercel.app`).
5. Deployments → redeploy the latest `main` build (env changes
   don't apply retroactively).
6. Verify: open `/finance/` on the Vercel domain → SPA loads;
   `/finance/connect` → institution list → bank link →
   `/finance/callback/` → lands back on `/finance/accounts`
   (proves `APP_BASE_URL` is right); Limits page → enable push
   (proves `VAPID_*` are set).
