# Proposal

## Why

Scheduled finance jobs — `check_balance_alerts` today;
`sync_bank_transactions` and `evaluate_spending_limits` when
re-enabled — run on a dedicated `all-jobs` Cloud Run job fired by
the `all-jobs-daily` Cloud Scheduler trigger. That whole slice of
infra (the job definition, scheduler, `cloud-scheduler` service
account + `run.invoker` binding, the `all-jobs` digest-protection
block in `cleanup-artifacts.yml`, and the deploy pipeline's
job-image update loop) exists only to invoke
`manage.py run_all_jobs` once a day. Vercel already runs the same
codebase and can trigger it over HTTP for $0, so the GCP
machinery is pure complexity — the motivation is simplification,
not savings (the job already fits the Cloud Run free tier).

This is a distilled, updated version of the historical proposal
`docs/plans/VERCEL_CRON_JOBS_PROPOSAL.md` (written when three
separate Cloud Run jobs existed; the repo has since consolidated
onto one `all-jobs` job + `run_all_jobs`).

## What Changes

- Add a bearer-token (`CRON_SECRET`) job-trigger endpoint to the
  ninja API that runs `run_all_jobs` synchronously and returns
  JSON — session auth MUST NOT apply; these are machine calls.
  The endpoint returns 404 when `CRON_SECRET` is unset so the
  surface doesn't exist where it isn't configured.
- Set `CRON_SECRET` on the Vercel project (Production scope) and
  add a `crons` array to `vercel.json` hitting the endpoint once
  daily — Vercel automatically sends
  `Authorization: Bearer $CRON_SECRET` to cron paths.
- After one verified scheduled run, remove the GCP-side trigger
  infra: the `all-jobs` Cloud Run job, `all-jobs-daily`
  scheduler job, `cloud-scheduler` SA + `run.invoker` binding,
  the `all-jobs` digest-protection block in
  `cleanup-artifacts.yml`, and the job-image update loop in
  `deploy.yml`.

## Capabilities

### New Capabilities

- `scheduled-jobs`: how scheduled management commands are
  triggered — a bearer-authenticated HTTP endpoint invoked by an
  external cron (Vercel Cron Jobs, or any HTTP caller with the
  token) instead of GCP-native scheduling.

### Modified Capabilities

<!-- None — `external-sync` covers sync semantics, which are
     unchanged; only the trigger mechanism moves. -->

## Impact

- `finance/api.py` (all `JOBS` entries are finance commands),
  `django_apps/settings.py` (`CRON_SECRET`), `.env.example`,
  `vercel.json`, `terraform/cloud_run_jobs.tf`,
  `.github/workflows/deploy.yml` + `cleanup-artifacts.yml`,
  `docs/VERCEL_SETUP.md`, `AGENTS.md`, `finance/AGENTS.md`.
- Vercel Hobby constraints apply and are acceptable: daily
  maximum + per-hour precision (fires anywhere in the hour) for a
  daily job; both sub-jobs run in seconds, far under the
  function-duration ceiling (300s with Fluid Compute, 60s on the
  legacy cap — confirm which applies before rollout).
