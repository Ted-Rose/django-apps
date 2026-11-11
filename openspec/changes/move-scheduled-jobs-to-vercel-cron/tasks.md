# Tasks

## 1. Job trigger endpoint

- [ ] 1.1 backend: Add `CRON_SECRET` to `django_apps/settings.py`
  (env/`config.yaml` chain like other settings, default `''`)
  and document the key in `.env.example`.
- [ ] 1.2 backend: In `finance/api.py` add a `HttpBearer`
  subclass comparing the token to `settings.CRON_SECRET` with
  `secrets.compare_digest`; register
  `POST /api/finance/jobs/run-all/` with `auth=` set to it —
  404 when the secret is empty, 401 on missing/wrong token,
  `call_command('run_all_jobs', stdout=StringIO())` on success,
  500 on exception (logged, no traceback in the body).
- [ ] 1.3 backend: Tests in `finance/test_api.py`: secret unset
  → 404; no/wrong token → 401 (also with a valid session
  cookie); right token runs the command (mock `call_command`)
  and returns `success`/`output`; exception → 500.

## 2. Vercel wiring

- [ ] 2.1 both: Add the `crons` array to `vercel.json`
  (`0 3 * * *` → `/api/finance/jobs/run-all/`) and, only if the
  project is on the legacy non-Fluid duration cap, a
  `functions.maxDuration` entry.
- [ ] 2.2 both: Update `docs/VERCEL_SETUP.md` (new
  `CRON_SECRET` runtime var row + a line that scheduled jobs
  are Vercel-driven) and `docs/changelog.md` when it ships.

## 3. GCP + docs teardown (post-cutover, after one verified run)

- [ ] 3.1 backend: Remove the `all-jobs` job, `all-jobs-daily`
  scheduler, `cloud-scheduler` SA and `run.invoker` binding
  from `terraform/cloud_run_jobs.tf` (comment out per repo
  convention, or delete); tell the user to run
  `terraform apply`.
- [ ] 3.2 backend: Drop the `all-jobs` digest-protection block
  in `.github/workflows/cleanup-artifacts.yml` and the
  job-image update loop in `deploy.yml`.
- [ ] 3.3 both: Update `AGENTS.md` (Deployment & CI section)
  and `finance/AGENTS.md` ("Management commands → Cloud Run
  jobs" section) to describe the Vercel-cron trigger; note the
  manual `curl` trigger for ops.
