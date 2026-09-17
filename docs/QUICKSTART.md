# GCP Cloud Run Deployment Quick Start

## Prerequisites Check

```bash
# Install gcloud CLI (if needed)
brew install --cask google-cloud-sdk  # macOS

# Authenticate
gcloud auth login
gcloud config set project gmail-vercel

# Verify permissions
gcloud projects get-iam-policy gmail-vercel | grep $(gcloud config get-value account)
```

## Deploy in 3 Steps

### 1. Run Bootstrap Script

```bash
./bootstrap_gcp.sh
```

This creates all GCP resources, secrets, and infrastructure.

**Note:** You'll be prompted to confirm billing link (a financial action).

### 2. Commit and Deploy

```bash
# Verify secrets are NOT staged
git status | grep -E "(GCP_DEPLOYMENT_PLAN|private_settings|ca.pem|app_secrets)"
# Should return nothing

# Stage changes
git add terraform/ .github/ django_apps/ google_api/ requirements.txt Dockerfile .dockerignore .gitignore bootstrap_gcp.sh *.md

# Commit
git commit -m "Add GCP Cloud Run deployment infrastructure"

# Deploy
git push origin main
```

### 3. Add OAuth Redirect URI (After First Deploy)

Get your Cloud Run URL:

```bash
gcloud run services describe django-apps --region=europe-west3 --project=gmail-vercel --format='value(status.url)'
```

Then go to: https://console.cloud.google.com/apis/credentials?project=gmail-vercel

Edit OAuth 2.0 Client ID → Add redirect URI:
```
https://YOUR-CLOUD-RUN-URL/google/callback
```

## Monitor Deployment

```bash
# Watch GitHub Actions
open https://github.com/Ted-Rose/gmail-to-audio/actions

# Watch Cloud Run logs
gcloud run services logs tail django-apps --region=europe-west3 --project=gmail-vercel

# Check service status
gcloud run services describe django-apps --region=europe-west3 --project=gmail-vercel
```

## Troubleshooting

### Bootstrap fails with "gcloud: command not found"
Install gcloud CLI (see Prerequisites above).

### "Permission denied" errors
Ensure you have Owner/Editor role on gmail-vercel project.

### Workflow files still show "PROJECT_NUMBER_PLACEHOLDER"
The bootstrap script should update these automatically. If not, get project number:
```bash
gcloud projects describe gmail-vercel --format='value(projectNumber)'
```

Then manually update `.github/workflows/terraform.yml` and `.github/workflows/deploy.yml`.

### OAuth callback errors after deployment
Ensure you completed step 2 (adding redirect URI in GCP Console).

## Files Created

- **11 Terraform files** in `terraform/`
- **2 GitHub Actions workflows** in `.github/workflows/`
- **1 Dockerfile** for containerized deployment
- **1 .dockerignore** for optimized builds
- **1 GCP helper**: `django_apps/gcp.py`
- **Updated**: `settings.py`, `utils.py`, `requirements.txt`, `.gitignore`
- **Documentation**: `DEPLOYMENT.md`, `IMPLEMENTATION_SUMMARY.md`
- **Automation**: `bootstrap_gcp.sh`

## What Gets Deployed

- **Cloud Run** (Python 3.12, 512Mi RAM, 1 CPU, 0-1 instances)
- **Artifact Registry** (max 3 images)
- **Secret Manager** (6 secrets)
- **Workload Identity Federation** (GitHub Actions auth)
- **Terraform state** (GCS bucket)

## Cost: ~$5-15/month 💰

**Huge savings!** Cloud Run scales to 0 when idle - you only pay for actual usage, not idle time.

See `IMPLEMENTATION_SUMMARY.md` for detailed breakdown.

## Full Documentation

- **Deployment Guide**: `DEPLOYMENT.md`
- **Implementation Details**: `IMPLEMENTATION_SUMMARY.md`
- **Original Plan**: `GCP_DEPLOYMENT_PLAN.md` (gitignored, contains secrets)
