# Proposal: Move scheduled jobs from Cloud Run to Vercel

Status: proposal — no code changed yet.

## 1. Current state — what's actually running

`terraform/cloud_run_jobs.tf` defines exactly **two** scheduled jobs
(plus a scheduler service account + two `run.invoker` IAM bindings):

| Job | Command | Schedule | Resources |
|-----|---------|----------|-----------|
| `sync-bank-transactions` | `python manage.py sync_bank_transactions` | `0 2 * * *` UTC | 1 vCPU / 512Mi |
| `evaluate-spending-limits` | `python manage.py evaluate_spending_limits` | `30 2 * * *` UTC | 1 vCPU / 512Mi |

Each job runs the full Docker image, pulls secrets from Secret Manager
via env vars, and is triggered by Cloud Scheduler → Cloud Run Jobs API
with an OAuth token.

Also relevant:

- `.github/workflows/deploy.yml` creates a one-off
  `django-migrate-<sha>` Cloud Run job per deploy — that stays on GCP
  (it must run inside the deploy pipeline, not on a schedule).
- `.github/workflows/cleanup-artifacts.yml` runs on a GitHub cron and
  currently contains a "protected digests" block that queries the two
  Cloud Run jobs so their pinned image digests aren't deleted — this
  complexity exists *only* because of the scheduled jobs.
- **Docs are stale**: root `AGENTS.md` claims `cloud_run_jobs.tf` is
  commented out and `finance/AGENTS.md` claims the schedulers are
  `paused = true`. In reality both schedulers are `paused = false` and
  the jobs run daily. Whichever state is intended, the docs and
  Terraform disagree — worth fixing either way.

## 2. Workload analysis — will it fit in a Vercel function?

`sync_bank_transactions`
(`finance/management/commands/sync_bank_transactions.py`):

- One GoCardless API call per linked account (`fetch_transactions`,
  30s client timeout), then `update_or_create` per transaction + rule
  categorization per viewer. Sequential, one account at a time.
- Expected runtime at personal scale (a few accounts): **2–10 s**.
  Worst case is a big initial backfill or a slow bank — bounded by the
  30s HTTP timeout per account.

`evaluate_spending_limits`:

- Pure DB aggregation + optional web-push sends. Expected runtime:
  **<2 s**.

**Vercel limits (verified against current docs):**

- Function max duration on **Hobby**: 300 s (5 min) default *and*
  maximum **with Fluid Compute** (the current default for new
  projects). For projects deployed before 2025-04-23 *without* Fluid
  Compute: default 10 s, configurable max **60 s**. This project uses
  the legacy `builds`/`routes` `vercel.json` shape, so it's worth
  confirming which mode applies — if Fluid is on, the 300 s ceiling
  makes the timeout question moot; if not, set
  `"functions": {"django_apps/wsgi.py": {"maxDuration": 60}}` and
  keep per-invocation work under ~50 s.
- Cron Jobs on **Hobby**: up to 100 jobs/project, but **once per day
  maximum** and only **per-hour precision** (a `0 2 * * *` job fires
  anywhere in 02:00–02:59). Both of our jobs are already daily and
  independent of each other, so both restrictions are non-issues.
- Cron jobs only run on **production** deployments — fine here.

## 3. Options

### Option A — Vercel Cron Jobs (recommended)

Add a `crons` array to `vercel.json`:

```json
"crons": [
  { "path": "/api/finance/jobs/sync-bank-transactions",
    "schedule": "0 2 * * *" },
  { "path": "/api/finance/jobs/evaluate-spending-limits",
    "schedule": "0 3 * * *" }
]
```

Two thin endpoints call `call_command()` synchronously and return JSON.
Vercel automatically sends `Authorization: Bearer $CRON_SECRET` to cron
paths when the `CRON_SECRET` env var is set — the endpoint just
compares it.

- **GCP cost: literally $0** — nothing in GCP is involved at all.
- Pros: simplest possible; scheduler lives next to the code that runs;
  removing Terraform resources entirely; no GCP credentials involved in
  triggering.
- Cons: Hobby restrictions (daily only, ±59 min jitter — acceptable);
  a failed run shows up only in Vercel logs (no retry config — Vercel
  retries cron deliveries on non-2xx, but observability is thinner
  than Cloud Scheduler's attempt history).

### Option B — Cloud Scheduler → HTTP POST to Vercel

Keep `google_cloud_scheduler_job` resources but change `http_target`
to `POST https://<vercel-domain>/api/finance/jobs/<name>` with the
same `Authorization: Bearer` header (no OIDC token needed; a static
secret suffices since it's our own endpoint).

- **GCP cost ≈ $0**: Cloud Scheduler gives **3 jobs free per month**
  (then $0.10/job/month — we'd use 2, so free), and an HTTPS call
  generates negligible egress. The billed Cloud Run *job execution*
  disappears.
- Pros: full cron syntax and precise timing on any plan; scheduler
  state stays in Terraform; Cloud Scheduler has retry config and
  per-attempt status history.
- Cons: keeps GCP infra for zero functional gain over Option A;
  scheduler jobs still need Terraform management; you're paying in
  complexity for a trigger Vercel gives you free.

### Option C — GitHub Actions cron → curl Vercel endpoint

```yaml
on:
  schedule:
    - cron: '0 2 * * *'
steps:
  - run: curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
        https://<vercel-domain>/api/finance/jobs/sync-bank-transactions
```

- **GCP cost: $0.** GitHub Actions: free on public repos; ~2,000
  min/month on private — a curl costs ~10 s of runner time.
- Pros: free, any frequency, logs visible in the Actions tab, secrets
  already managed there; repo already uses scheduled workflows
  (`cleanup-artifacts.yml`).
- Cons: scheduled workflows can be delayed minutes under load and are
  auto-disabled after 60 days of repo inactivity (fine for an active
  repo); slightly more YAML than Option A.

### Option D — Pub/Sub

Ruled out. Pub/Sub can't call an HTTPS endpoint directly in a useful
way here (push subscriptions exist, but auth config + the topic +
subscription ≈ more infra than Cloud Scheduler), and the alternative —
a Cloud Function/Run subscriber — is a compute hop that reintroduces
exactly the billed execution we're trying to avoid. Pub/Sub's 10
GB/month free tier is irrelevant; the subscriber is the cost.

### Option E — keep Cloud Run jobs (honest baseline)

Worth stating plainly: **these jobs almost certainly cost $0 today.**
Cloud Run's free tier covers 180k vCPU-s + 360k GiB-s + 2M requests per
month; two daily ~10–30 s jobs use ~1% of that. The real GCP spend is
likely the Cloud Run *service* (when it handles traffic) and Artifact
Registry storage. Moving the jobs to Vercel is justified by
**simplification**, not savings: it removes the scheduler SA, two IAM
bindings, two job definitions, the digest-protection hack in
`cleanup-artifacts.yml`, and the need to keep pulling images on a
schedule.

## 4. Recommended design (Option A, with C as fallback)

### Endpoints

Per repo convention, API endpoints live in the app's ninja router —
add to `finance/api.py` (mounted at `/api/finance/`):

- `POST /api/finance/jobs/sync-bank-transactions`
- `POST /api/finance/jobs/evaluate-spending-limits`

Auth: a ninja `HttpBearer` subclass that compares the token to
`settings.CRON_SECRET` (constant-time compare), passed as `auth=` on
these two routes to override the router's default `django_auth`.
Session auth must *not* apply — these are machine calls.

Handler: `call_command('sync_bank_transactions', stdout=StringIO())`,
return `{"success": true, "output": ...}`; catch exceptions → 500 with
the message. Vercel retries non-2xx cron deliveries.

### Settings

`CRON_SECRET = env/private_settings('CRON_SECRET', '')`; if empty, the
endpoints return 404 (feature disabled) rather than 401 — avoids
probing surface on deployments where it isn't configured.

Set `CRON_SECRET` as a Vercel env var (production scope). The Cloud
Run deployment will also expose these routes; either give it the same
secret via Secret Manager or leave it unset there (404 = disabled).

### Timeout guardrail

Confirm Fluid Compute / effective `maxDuration` for the project:

```json
"functions": { "django_apps/wsgi.py": { "maxDuration": 300 } }
```

(set to 60 if on the legacy non-Fluid Hobby cap). At current scale
both jobs finish in seconds; if `sync_bank_transactions` ever
approaches the ceiling, add an `?account=<id>` fan-out mode (one
request per account, like `fetch_balances_parallel`'s threading
pattern) rather than lengthening the single run.

### Terraform / repo cleanup after cutover

- Comment out (repo convention) or delete: the two
  `google_cloud_run_v2_job` resources, both
  `google_cloud_scheduler_job`s, both `run.invoker` bindings, and the
  `cloud-scheduler` service account.
- Remove the "protected digests" loop in `cleanup-artifacts.yml`
  (lines ~53–81) — nothing pins job digests anymore.
- Update root `AGENTS.md` + `finance/AGENTS.md` (they're stale
  regardless: they currently claim the file is commented out /
  schedulers paused, which is false today).

### Rollout

1. Add endpoints + `CRON_SECRET` setting + tests (401 without token,
   200 runs command, 404 when secret unset).
2. Deploy, set `CRON_SECRET` on Vercel, smoke-test with
   `curl -X POST -H "Authorization: Bearer $CRON_SECRET" ...`.
3. Add `crons` to `vercel.json`, deploy.
4. Verify one scheduled run in Vercel logs.
5. Pause GCP schedulers (`paused = true`) for one cycle, then remove
   the GCP job infra.

## 5. Summary

| Option | GCP cost | Complexity | Fit |
|--------|----------|-----------|-----|
| A. Vercel Cron | $0 | lowest | best — daily jobs, Hobby limits don't bite |
| B. Cloud Scheduler → Vercel | ~$0 (free tier) | medium | only if precise timing/retries needed |
| C. GitHub Actions → Vercel | $0 | low | good fallback, already-used pattern |
| D. Pub/Sub | >$0 | high | ruled out |
| E. Status quo | ~$0 (free tier) | highest | honest baseline — savings are about simplicity, not money |

Recommendation: **A**, with the endpoints designed so any external
trigger (B or C) can call them with the same bearer token later.
