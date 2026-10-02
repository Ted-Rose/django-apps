# GCP Migration: gmail-vercel → django-apps

## Goal

Re-create all GCP infrastructure in project `django-apps` (it was
accidentally deployed to `gmail-vercel`), wire CI/CD to the new
project, and hand the user the new Cloud Run URL.

**Hard constraints:**

- **Non-destructive**: nothing in `gmail-vercel` is deleted. The only
  mutation there is *pausing* its Cloud Scheduler jobs (Phase 8) so the
  same jobs don't run twice against the shared database — reversible
  with `gcloud scheduler jobs resume`.
- **Autonomous**: every step is a shell command or a file edit the
  agent can run. Google Cloud auth is **already done** — both
  `gcloud auth login` and `gcloud auth application-default login`
  (terraform's ADC) are in place. Only two human checkpoints remain
  (marked `🧑 USER`):
  1. Adding the OAuth redirect URI in the GCP Console (no API exists)
  2. Billing link, only if the account lacks billing perms
- **Same database**: `DATABASE_URL` is copied verbatim — the new
  project talks to the same Aiven Postgres as the old project and
  Vercel. No data migration. Watch `max_connections` (Aiven small
  plan) — the old project keeps running, so idle connections double.

---

## What exists now (state of the repo)

Terraform manages, per project: 13 APIs (`main.tf`), Artifact
Registry `gae-standard`, Cloud Run service `django-apps`, **3 Cloud
Run jobs** (`sync-bank-transactions`, `evaluate-spending-limits`,
`check-balance-alerts`) + **3 Cloud Scheduler triggers**, GCS audio
bucket `<project>-audio-recordings` (7-day lifecycle), tfstate bucket
`<project>-tf-state`, service accounts `cloudrun-sa` /
`github-deployer` / `cloud-scheduler`, WIF pool `github-actions`, and
**11 secrets** referenced as data sources in `terraform/secrets.tf`:

`DJANGO_SECRET_KEY`, `ESV_KEY`, `DATABASE_URL`, `DB_SSL_CERT`,
`GOOGLE_OAUTH_CLIENT_JSON`, `APP_BASE_URL`, `GOCARDLESS_SECRET_ID`,
`GOCARDLESS_SECRET_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`

(`ESV_KEY` is vestigial — the bible app that used it was removed, but
the data source remains, so the secret must exist. `DB_SSL_CERT` is
likewise referenced but unread by settings.py. Copy both anyway.)

---

## Phase 0 — Preflight

```bash
# Install CLIs (this machine has none of them)
brew install --cask google-cloud-sdk   # or apt-equivalent
brew install terraform
brew install gh                        # optional, for CI status checks
```

Google Cloud auth is already done — just verify both the user
credentials and Application Default Credentials (used by terraform)
are live:

```bash
gcloud auth list                                  # active account
gcloud auth application-default print-access-token \
  >/dev/null && echo "ADC OK"                     # terraform auth
```

Then the agent captures IDs:

```bash
gcloud auth list                       # active account present
gcloud projects describe gmail-vercel --format='value(projectNumber)'
gcloud projects describe django-apps \
  --format='value(projectNumber,lifecycleState)'
# If the django-apps project doesn't exist:
#   gcloud projects create django-apps --name=django-apps
#   (project IDs are global; if taken, pick e.g. django-apps-ted and
#    substitute it everywhere below)
```

Required permissions: Editor+ on `django-apps`,
`secretmanager.secretAccessor` (or Editor) on `gmail-vercel`.

Export for all later phases:

```bash
OLD=gmail-vercel
NEW=django-apps
REGION=europe-west3
NEW_NUM=$(gcloud projects describe $NEW --format='value(projectNumber)')
```

---

## Phase 1 — Billing + APIs on django-apps

```bash
# Reuse the same billing account as the old project
BILLING=$(gcloud beta billing projects describe $OLD \
  --format='value(billingAccountName)')
gcloud billing projects link $NEW --billing-account="$BILLING"
```

🧑 **USER** (only if the link command fails with a permission error):
link billing manually at
`https://console.cloud.google.com/billing/linkedaccount?project=django-apps`

```bash
# Enable all APIs terraform expects (idempotent; doing it up front
# lets targeted terraform applies run without ordering hacks)
gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com cloudresourcemanager.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com \
  secretmanager.googleapis.com serviceusage.googleapis.com \
  storage.googleapis.com logging.googleapis.com \
  monitoring.googleapis.com tasks.googleapis.com \
  cloudscheduler.googleapis.com \
  --project=$NEW
```

---

## Phase 2 — Copy all secrets old → new

Values are piped directly — **never print them**. `versions add`
fallback makes this idempotent:

```bash
for s in DJANGO_SECRET_KEY ESV_KEY DATABASE_URL DB_SSL_CERT \
         GOOGLE_OAUTH_CLIENT_JSON APP_BASE_URL \
         GOCARDLESS_SECRET_ID GOCARDLESS_SECRET_KEY \
         VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT; do
  gcloud secrets versions access latest --secret=$s --project=$OLD \
    | gcloud secrets create $s --project=$NEW --data-file=- \
        --replication-policy=automatic 2>/dev/null \
    || gcloud secrets versions access latest --secret=$s \
        --project=$OLD \
    | gcloud secrets versions add $s --project=$NEW --data-file=-
done
```

Sanity check (names only): `gcloud secrets list --project=$NEW` must
show all 11.

`APP_BASE_URL` is overwritten in Phase 5 once the new URL is known —
copying the old value is fine as a placeholder.

---

## Phase 3 — Update code references

The agent edits files directly (`migrate_to_django_apps.sh` and
`bootstrap_gcp.sh` are interactive + stale — do **not** run them; see
Appendix). Substitute `$NEW_NUM` = project number from Phase 0.

**terraform/**

- `ci.auto.tfvars`: `project_id = "django-apps"`
- `variables.tf`: `project_id` default → `"django-apps"` **and**
  `github_repo` default → `"Ted-Rose/django-apps"` (currently the
  stale `"Ted-Rose/gmail-to-audio"`; `ci.auto.tfvars` already
  overrides it, but fix the default)
- `backend.tf`: `bucket = "django-apps-tf-state"`
- `state_bucket.tf`: `name = "django-apps-tf-state"`

**.github/workflows/deploy.yml**

- `GCP_PROJECT_ID`, `DEPLOY_SA`, `ARTIFACT_REGISTRY`: `gmail-vercel` →
  `django-apps`
- `WIF_PROVIDER`: `projects/<NEW_NUM>/locations/global/...`
- Fix the hardcoded audio bucket while here:
  `GCS_AUDIO_BUCKET=gmail-vercel-audio-recordings` →
  `GCS_AUDIO_BUCKET=${{ env.GCP_PROJECT_ID }}-audio-recordings`
  (otherwise every deploy points the new service at the old bucket)
- Job loop (line ~95): add `check-balance-alerts` — the third job is
  missing from the loop, so its image is never updated

**.github/workflows/terraform.yml** — `GCP_PROJECT_ID`,
`DEPLOY_SA`, `WIF_PROVIDER` (same replacements)

**.github/workflows/cleanup-artifacts.yml** — same four vars, and add
`check-balance-alerts` to the `PROTECTED_DIGESTS` loop (its pinned
digest is currently unprotected → cleanup can break the job)

**Docs** — replace `gmail-vercel` → `django-apps` where it's the GCP
project: `AGENTS.md` (2 spots), `docs/QUICKSTART.md` (all references),
`docs/VERCEL_SETUP.md` (the `GCS_AUDIO_BUCKET` row — new bucket name
`django-apps-audio-recordings`).

**Do NOT commit/push yet** — pushing `deploy.yml` to `main` fires a
deploy against the new project, which doesn't exist yet.

---

## Phase 4 — Provision django-apps

> ⚠️ **Known bug hit on the `django-apps-7345` migration:** the
> Cloud Run service was created before `cloudrun-sa`'s
> `secretAccessor` grant existed → revision stuck at
> `SecretsAccessCheckFailed`, site 503s. The `depends_on` fix is in
> the repo and the commands below pre-apply the IAM grant + let it
> propagate — don't skip them on a fresh project. Full diagnosis and
> recovery: `GCP_MIGRATION_SECRETS_RACE.md`.

Terraform state bucket chicken-and-egg: `backend.tf` points at a
bucket that doesn't exist yet. Same trick `bootstrap_gcp.sh` used,
non-interactively:

```bash
cd terraform
mv backend.tf backend.tf.disabled
mv terraform.tfstate terraform.tfstate.old 2>/dev/null   # stale local
mv terraform.tfstate.backup terraform.tfstate.backup.old 2>/dev/null
terraform init                       # local backend
terraform apply -auto-approve \
  -target=google_storage_bucket.terraform_state
mv backend.tf.disabled backend.tf
terraform init -migrate-state -force-copy   # push state to new bucket
```

Artifact Registry must exist before the Cloud Run service can be
created (it references an image in it), and the image must exist
before `google_cloud_run_v2_service` applies:

```bash
terraform apply -auto-approve \
  -target=google_artifact_registry_repository.gae_standard

# Fresh project: pre-apply the Cloud Run service account + its
# secretAccessor grant so the IAM edge exists before Cloud Run
# creation is attempted — `depends_on` (already in the repo) orders
# creation, but IAM grants need ~60-90s to propagate inside GCP.
terraform apply -auto-approve \
  -target=google_service_account.cloudrun \
  -target=google_project_iam_member.cloudrun_secret_accessor

# Build in Cloud Build — no local Docker needed
cd ..
gcloud builds submit \
  --tag $REGION-docker.pkg.dev/$NEW/gae-standard/django-apps:latest \
  --project=$NEW --timeout=1800

cd terraform
sleep 60                       # finish IAM propagation
terraform apply -auto-approve    # SAs, WIF, Cloud Run svc+jobs, scheduler, buckets
terraform output                 # keep cloud_run_url + workload_identity_provider
```

If the Cloud Run service still comes up `SecretsAccessCheckFailed`
(a revision stuck there never self-heals — it must be deleted and
re-created), follow the recovery steps at the bottom of
`GCP_MIGRATION_SECRETS_RACE.md`.

If `terraform output workload_identity_provider` disagrees with the
`WIF_PROVIDER` written in Phase 3, fix the workflows to match the
output — it's authoritative.

---

## Phase 5 — APP_BASE_URL + smoke test

```bash
URL=$(gcloud run services describe django-apps --region=$REGION \
  --project=$NEW --format='value(status.url)')
printf '%s' "$URL" | gcloud secrets versions add APP_BASE_URL \
  --project=$NEW --data-file=-

curl -sI "$URL" | head -1      # expect HTTP/2 200 or 302 → /login/
gcloud run services logs tail django-apps --region=$REGION \
  --project=$NEW | head -30    # no secret/DB errors
```

A new secret version only reaches Cloud Run on a fresh revision — the
push in Phase 6 redeploys, so no manual redeploy needed.

---

## Phase 6 — Commit & push, verify CI

```bash
git add terraform/ .github/workflows/ AGENTS.md docs/ \
  && git commit -m "Migrate GCP infrastructure to django-apps project" \
  && git push origin main
```

Watch both workflows at `https://github.com/Ted-Rose/django-apps/actions`:

- `Terraform` — apply should be a no-op (already applied in Phase 4)
- `Deploy to Cloud Run` — builds, runs `manage.py migrate` against the
  shared DB, deploys, updates all 3 job images
- `Cleanup Artifact Registry` — runs after deploy success

Then re-verify `curl -sI $URL` → 200/302.

---

## Phase 7 — OAuth redirect URI

🧑 **USER**: Google OAuth clients are console-only (no gcloud/API).
The client JSON's `project_id` field says which project owns it:

```bash
gcloud secrets versions access latest \
  --secret=GOOGLE_OAUTH_CLIENT_JSON --project=$NEW \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["web"]["project_id"])'
```

In `https://console.cloud.google.com/apis/credentials?project=<that-project>`,
edit the OAuth 2.0 client and add:

```
https://<NEW_CLOUD_RUN_URL>/google/callback
```

Keep the old URI (old project still runs). Until this is done, Google
login on the new URL fails with `redirect_uri_mismatch` — everything
else works.

No GoCardless or Vercel changes needed: `APP_BASE_URL` is read per
request, and Vercel env vars are literal values independent of the GCP
project (its `GCS_AUDIO_BUCKET` is moot — Vercel lambdas have no GCP
credentials anyway).

---

## Phase 8 — Pause old project's schedulers

Both projects now point at the same DB; leaving `gmail-vercel`'s
schedulers active would double-run the bank syncs against GoCardless
rate limits. Pause (do not delete):

```bash
for j in sync-bank-transactions-schedule \
         evaluate-spending-limits-schedule \
         check-balance-alerts-schedule; do
  gcloud scheduler jobs pause $j --location=$REGION --project=$OLD
done
```

Old Cloud Run service keeps serving its own URL — harmless duplicate.

---

## Deliverable

Report to the user:

```
https://$(gcloud run services describe django-apps \
  --region=$REGION --project=$NEW --format='value(status.url)' | sed 's|https://||')
```

Verification checklist: home page loads → `/tasks/` SPA loads →
Google OAuth login round-trips (after Phase 7) → next morning, confirm
the new project's scheduler executions ran and the old ones didn't.

---

## Appendix — stale scripts, don't run

- `bootstrap_gcp.sh`: interactive prompts; creates only 5 of the 11
  required secrets; pulls billing from `bible-research-489314`;
  searches for a `PROJECT_NUMBER_PLACEHOLDER` that no longer exists;
  footer links point at the old `Ted-Rose/gmail-to-audio` repo.
  Superseded by Phases 1–5 above. Optionally update or delete.
- `migrate_to_django_apps.sh`: two `read -p` prompts (blocks
  automation), misses `cleanup-artifacts.yml`, the
  `GCS_AUDIO_BUCKET` env in `deploy.yml`, the `github_repo` default,
  and docs. Superseded by Phase 3.
