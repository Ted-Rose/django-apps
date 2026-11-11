# Design

## Current state (verified 2026-11)

- `terraform/cloud_run_jobs.tf` defines ONE
  `google_cloud_run_v2_job` `all-jobs`
  (`python manage.py run_all_jobs`), the `all-jobs-daily`
  `google_cloud_scheduler_job` (03:00 UTC), the
  `cloud-scheduler` service account and one `run.invoker`
  binding.
- `run_all_jobs`' `JOBS` list is the enable switch: only
  `check_balance_alerts` is enabled; `sync_bank_transactions`
  and `evaluate_spending_limits` are commented out.
- `deploy.yml` refreshes the job image on every deploy;
  `cleanup-artifacts.yml` queries `all-jobs` to protect its
  pinned image digest from deletion.
- Expected runtimes are seconds (one GoCardless call per linked
  account at 30s timeout worst case; the limit evaluator is a
  pure DB read + optional web-push).

## Options considered (from the original proposal, still valid)

- **A. Vercel Cron Jobs → bearer endpoint (recommended).** $0,
  least code, removes all GCP trigger infra. Hobby plan allows
  daily-only, per-hour precision — both fine for a daily job.
  Thinner observability than Cloud Scheduler's attempt history.
- **B. Cloud Scheduler → HTTPS POST to Vercel.** Precise timing
  and retry history; keeps Terraform-managed GCP infra for zero
  functional gain over A.
- **C. GitHub Actions cron → curl the endpoint.** $0, visible
  logs, already-used pattern; scheduled workflows jitter and
  auto-disable after 60 days of repo inactivity.
- **D. Pub/Sub.** Ruled out — a push subscription + auth config +
  subscriber is more infra than Cloud Scheduler.
- **E. Status quo.** Honest baseline: cost is already ~$0. The
  change is justified by deleting the job/scheduler/SA/binding/
  digest-hack/image-update-loop machinery, not by savings.

Option A is recommended; the endpoint design leaves B and C open
— any HTTP caller with the token triggers the same path.

## Endpoint design

- Add to `finance/api.py` (all `JOBS` entries are finance
  management commands): `POST /api/finance/jobs/run-all/` —
  `call_command('run_all_jobs', stdout=StringIO())`, return
  `{"success": true, "output": ...}`; exception → 500.
- Auth: a ninja `HttpBearer` subclass doing a constant-time
  compare against `settings.CRON_SECRET`, passed as `auth=` on
  this route to override the router's `django_auth` default —
  session cookies must NOT authenticate it.
- `CRON_SECRET` read in `settings.py` from env/`config.yaml`
  like every other setting; empty → the route 404s.
- One endpoint, not one per sub-job: `run_all_jobs`' `JOBS`
  list + schedule specs already decide what runs when; a second
  endpoint per command would duplicate that switch. `--force`/
  `--only` stay operator-only (`manage.py` / `gcloud run jobs
  execute`-style manual runs are unaffected).

## vercel.json

```json
"crons": [
  { "path": "/api/finance/jobs/run-all/", "schedule": "0 3 * * *" }
]
```

Confirm the effective function duration ceiling first (Fluid
Compute → 300s; legacy non-Fluid Hobby → set
`"functions": {"django_apps/wsgi.py": {"maxDuration": 60}}`).
Current jobs finish in seconds; if a future backfill ever nears
the ceiling, add a `?only=<name>` fan-out rather than raising
the limit.

## Rollout

1. Endpoint + `CRON_SECRET` setting + tests; deploy.
2. Set `CRON_SECRET` (Production scope) on the Vercel project;
   smoke-test with `curl -X POST -H "Authorization: Bearer …"`.
3. Add `crons` to `vercel.json`; deploy; verify one scheduled
   run in Vercel logs.
4. Remove GCP trigger infra (terraform `cloud_run_jobs.tf`
   resources + the deploy/cleanup workflow blocks); hand the
   `terraform apply` to the user per repo rules.

## Explicitly out of scope

- Per-job endpoints, retries/dead-lettering beyond Vercel's
  built-in non-2xx retry, and re-enabling the two commented-out
  `JOBS` entries (a separate product decision).
- The `django-migrate-<sha>` one-off deploy job — it must run
  inside the deploy pipeline, not on a schedule.
