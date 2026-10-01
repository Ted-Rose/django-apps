# Vercel configuration — what to set and why

Where: **Vercel dashboard → `django-apps` project → Settings →
Environment Variables**. Changes require a redeploy to take effect
(Deployments → ⋯ → Redeploy).

No `vercel.json` changes are needed for the finance React SPA —
Django's `<path:subpath>` catch-all already serves the shell on every
`/finance/*` deep link, and `/static/*` still routes to the CDN.

## Environment variables

### Runtime (used by the serverless function)

| Variable | Value | Notes |
|---|---|---|
| `DJANGO_SECRET_KEY` | same as Cloud Run's `django-secret-key` | copy from GCP Secret Manager or local `private_settings.json` → `SECRET_KEY` |
| `APP_BASE_URL` | `https://<your-vercel-domain>` (e.g. `https://tedisrozenfelds.vercel.app`) | **Must match the host serving the traffic.** GoCardless bakes `{BASE_URL}/finance/callback/` into the requisition; if a user starts Connect Bank on Vercel but `APP_BASE_URL` points at Cloud Run, the callback lands there and the session cookie is gone → "No pending bank connection found." |
| `DATABASE_URL` | Aiven Postgres URL, e.g. `postgres://user:pass@host:port/db?sslmode=verify-full&sslrootcert=<path-to-ca.pem>` | Same DB as Cloud Run. `sslmode` defaults to `require` if unset; `verify-full` needs the `ca.pem` generated at build time from `capem` (written to the repo root, i.e. `/var/task/ca.pem` in the lambda). `CONN_MAX_AGE=0` is automatic on Vercel — keep it that way to protect Aiven's `max_connections`. |
| `GOOGLE_OAUTH_CLIENT_JSON` | full contents of `google_api/app_secrets.json` | written to `/tmp/app_secrets.json` at settings import |
| `ESV_KEY` | your esv.org API key | bible_research |
| `GOCARDLESS_SECRET_ID` | GoCardless Bank Account Data secret id | finance — same value as Cloud Run |
| `GOCARDLESS_SECRET_KEY` | GoCardless Bank Account Data secret key | finance — same value as Cloud Run |
| `VAPID_PUBLIC_KEY` | same as Cloud Run | **Must be identical on both deploys** — `PushSubscription` rows are shared via the DB; mismatched keys break pushes for browsers that subscribed on the other deploy |
| `VAPID_PRIVATE_KEY` | same as Cloud Run | |
| `VAPID_SUBJECT` | `mailto:<your-email>` | required by Web Push (contact URI) |
| `GCS_AUDIO_BUCKET` | `gmail-vercel`-project audio bucket name | optional — only needed if `text_to_audio` is exercised via Vercel; the code logs an error if unset |

`VERCEL=1` is injected by Vercel automatically (build + runtime) — do
not set it manually; it's what puts `settings.py` into cloud mode.

### Build time (consumed by `build_files.sh`)

| Variable | Value | Notes |
|---|---|---|
| `capem` | full PEM text of the Aiven project CA certificate | parsed and written to `ca.pem` during build (needed only if `DATABASE_URL` uses `sslmode=verify-full`) |
| `private_settings` | JSON blob of `private_settings.json` | written to `private_settings.json` during build. Effectively redundant while `VERCEL=1` is set (cloud env vars take precedence), but the build script still generates it — keep it in sync if you set it |

## Scope settings

Set every variable above to the **Production** environment (that's
what live traffic uses). This is also why **preview deployments
currently fail**: the vars are Production-scoped, so preview builds
run `collectstatic`/`migrate` without them.

To fix previews (optional): add the same variables with the
**Preview** scope too — either point them at the same Aiven DB
(simplest, but shares `max_connections` with prod) or a scratch
database.

## Checklist

1. Settings → Environment Variables: confirm/add every runtime var
   above, scoped to **Production** (and Preview if you want preview
   deploys).
2. `APP_BASE_URL` = the Vercel domain (with `https://`, no trailing
   slash). If you attach a custom domain, also add it to
   `ALLOWED_HOSTS` in `django_apps/settings.py` (currently
   `.vercel.app` + `tedisrozenfelds.vercel.app`).
3. Deployments → redeploy the latest `main` build (env changes don't
   apply retroactively).
4. Verify: open `/finance/` on the Vercel domain → SPA loads;
   `/finance/connect` → institution list → bank link →
   `/finance/callback/` → lands back on `/finance/accounts` (proves
   `APP_BASE_URL` is right); Limits page → enable push (proves
   `VAPID_*` are set).
