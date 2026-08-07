# GCP Migration: gmail-vercel → django-apps

## Overview

All infrastructure was accidentally deployed to GCP project `gmail-vercel`.
This documents the steps to migrate everything to `django-apps`.

---

## Prerequisites

- `gcloud` CLI authenticated (`gcloud auth login`)
- `terraform` CLI installed
- Owner/Editor permissions on both `gmail-vercel` and `django-apps`
- `django-apps` GCP project exists with billing enabled

---

## Phase 1 — Gather info

Get the `django-apps` project number (needed for WIF provider URL):

```bash
gcloud projects describe django-apps --format='value(projectNumber)'
```

---

## Phase 2 — Update code references

Run `migrate_to_django_apps.sh` with the project number filled in.
It will update all hardcoded references in:

- `terraform/ci.auto.tfvars`
- `terraform/variables.tf`
- `terraform/backend.tf`
- `terraform/state_bucket.tf`
- `.github/workflows/deploy.yml`
- `.github/workflows/terraform.yml`
- `bootstrap_gcp.sh`

---

## Phase 3 — Bootstrap django-apps

Run the updated `bootstrap_gcp.sh`. It will:

1. Link billing account to `django-apps`
2. Enable Secret Manager API
3. Re-create all secrets in `django-apps` Secret Manager:
   - `DJANGO_SECRET_KEY`
   - `ESV_KEY`
   - `DATABASE_URL`
   - `DB_SSL_CERT`
   - `GOOGLE_OAUTH_CLIENT_JSON`
   - `APP_BASE_URL`
4. Create Terraform state bucket (`django-apps-tf-state`)
5. Build and push Docker image to new Artifact Registry
6. Run `terraform apply` → provisions Cloud Run, IAM roles, WIF pool

---

## Phase 4 — Post-deploy

1. Get new Cloud Run URL:
   ```bash
   gcloud run services describe django-apps \
     --region=europe-west3 \
     --project=django-apps \
     --format='value(status.url)'
   ```

2. Update `APP_BASE_URL` secret with the new URL:
   ```bash
   printf '%s' 'https://YOUR_CLOUD_RUN_URL' | \
     gcloud secrets versions add APP_BASE_URL \
       --project=django-apps \
       --data-file=-
   ```

3. Update Google OAuth redirect URIs:
   - Go to: https://console.cloud.google.com/apis/credentials?project=django-apps
   - Add: `https://YOUR_CLOUD_RUN_URL/google/callback`

---

## Phase 5 — Clean up gmail-vercel (optional)

Avoid ongoing costs by tearing down the old project's resources.
Before running destroy, temporarily revert `ci.auto.tfvars` to point at `gmail-vercel`
and re-init the backend, or do it manually in the GCP Console.

```bash
# Point terraform at old state bucket temporarily
# Then:
cd terraform
terraform destroy
```

Or delete manually in GCP Console:
- Cloud Run service: `django-apps`
- Artifact Registry: `gae-standard`
- Secret Manager secrets (6 secrets)
- Service accounts: `cloudrun-sa`, `github-deployer`
- WIF pool: `github-actions`
- State bucket: `gmail-vercel-tf-state`
