# Cleanup: remove the Cloud Run migration job

> **Status**: Implemented (2026-10-01).
>
> Implementation note: the preferred "fetch secrets in-step" variant
> was used, but with `export` instead of `$GITHUB_ENV` — env-file
> appends only apply to *subsequent* steps, so `migrate` in the same
> `run` block would not have seen `DATABASE_URL`.

## Context

`deploy.yml` currently runs migrations by creating an **ephemeral
Cloud Run job** per deploy (`django-migrate-<sha>`), executing it,
then deleting it (`.github/workflows/deploy.yml`, step
"Run database migrations via Cloud Run Jobs").

This mechanism has two recurring costs:

- It needs the DB connection to work inside the container — the
  `sslmode=verify-full` / missing `root.crt` failure of Sep 28–30
  (15 failed deploys) was surfaced here first.
- It adds ~1 min of job create/execute/delete orchestration per deploy
  plus `gcloud logging read` debugging plumbing.

Decision: run `manage.py migrate` **directly on the GitHub Actions
runner** instead. Aiven Postgres is publicly reachable, `sslmode=require`
(now set in the `DATABASE_URL` secret) needs no CA cert file, and the
runner is already authenticated to GCP via WIF, so it can read the
secrets it needs. No Cloud Run involvement at all.

## Steps

### 1. Replace the migration step in `.github/workflows/deploy.yml`

Delete the whole "Run database migrations via Cloud Run Jobs" step
(≈40 lines of job create/execute/logs/delete) and replace with:

```yaml
      - name: Set up Python for migrations
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: pip

      - name: Install dependencies
        run: pip install -r requirements.txt

      - name: Run database migrations
        env:
          USE_GCP_SECRETS: 'true'
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DJANGO_SECRET_KEY: ${{ secrets.DJANGO_SECRET_KEY }}
        run: python manage.py migrate --noinput
```

Notes:

- `secrets.DATABASE_URL` / `secrets.DJANGO_SECRET_KEY` must exist as
  **GitHub Actions secrets** (repo Settings → Secrets). They are not
  defined there today — the workflow reads everything from GCP Secret
  Manager via the Cloud Run job's service account. Copy the values once
  (`gcloud secrets versions access latest --secret=DATABASE_URL
  --project=gmail-vercel`) into GitHub secrets. Alternative without
  duplicating secrets: fetch them in-step with
  `gcloud secrets versions access` into `$GITHUB_ENV` — works because
  WIF auth already ran — but then the values live only in GCP (single
  source of truth). That variant:

  ```yaml
      - name: Run database migrations
        run: |
          echo "DATABASE_URL=$(gcloud secrets versions access latest \
            --secret=DATABASE_URL --project=${{ env.GCP_PROJECT_ID }})" \
            >> "$GITHUB_ENV"
          echo "DJANGO_SECRET_KEY=$(gcloud secrets versions access latest \
            --secret=DJANGO_SECRET_KEY --project=${{ env.GCP_PROJECT_ID }})" \
            >> "$GITHUB_ENV"
          USE_GCP_SECRETS=true python manage.py migrate --noinput
  ```

  Prefer this variant — it avoids maintaining a second copy of the
  secrets. (`:latest` resolves at run time; WIF SA already has
  `secretAccessor` for these secrets.)
- `pip install -r requirements.txt` is needed because `settings.py`
  import pulls every `INSTALLED_APPS` dependency (django-vite, ninja,
  google libs…). With `cache: pip` it costs a few seconds on repeat
  runs.
- Keep this step **before** "Deploy to Cloud Run" — same ordering
  guarantee the job gave (migrate → then roll out the new image).

### 2. Remove leftover Cloud Run job artifacts

- The ephemeral jobs self-delete, but check for strays from failed
  runs:
  `gcloud run jobs list --project=gmail-vercel --region=europe-west3`
  — delete any `django-migrate-*` jobs found.
- Nothing else in GCP is dedicated to migrations — the job was created
  ad hoc by the workflow, not by terraform.

### 3. Do NOT touch `terraform/cloud_run_jobs.tf`

The commented-out blocks there are the *scheduled* jobs
(`sync-bank-transactions`, `evaluate-spending-limits`) — unrelated to
migrations. Leave them commented (cost saving, per AGENTS.md).

### 4. Update docs after implementing

- `AGENTS.md`: the line "CI deploy runs `migrate` via a Cloud Run job"
  under Database migrations → change to "via the GitHub Actions
  runner".
- `docs/QUICKSTART.md` if it mentions the migrate job.
- This file: mark done.

## Side benefits

- One less thing to break when `DATABASE_URL`/SSL config changes —
  the runner uses the same `dj_database_url` parse + `sslmode=require`.
- Faster deploys (no job create/execute/delete roundtrip).
- Migration failures surface directly in the Actions log — no
  `gcloud logging read` detour needed.

## Caveats

- The runner connects to Aiven over the public internet — same as the
  old job did from Cloud Run. `sslmode=require` keeps traffic
  encrypted; server cert verification is intentionally off (matches
  Cloud Run's historical behavior).
- If `DATABASE_URL` is ever switched back to `verify-full`, the runner
  needs the CA cert too — fetch `DB_SSL_CERT` and pass
  `sslrootcert=<path>` the same way.
- Vercel's build already runs `migrate` (`build_files.sh`) on every
  deploy; that stays as-is and is harmless (migrations are idempotent).

## Verification

1. Push a branch/PR is not enough — `deploy.yml` only runs on `main`.
   Merge something trivial or use `workflow_dispatch`.
2. Confirm the "Run database migrations" step exits 0 and logs
  "No migrations to apply" (or applies them).
3. `gcloud run jobs list --project=gmail-vercel --region=europe-west3`
  → no `django-migrate-*` jobs.
4. Cloud Run service still serves traffic after deploy.
