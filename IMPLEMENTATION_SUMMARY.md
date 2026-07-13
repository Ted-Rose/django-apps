# GCP Cloud Run Deployment Implementation Summary

## ✅ Completed Implementation

All code and configuration files have been created for Cloud Run deployment with 0-1 instance scaling. The implementation is ready for deployment.

### Files Created

#### Terraform Infrastructure (`terraform/`)
- ✅ `variables.tf` - Project configuration (gmail-vercel, europe-west3)
- ✅ `main.tf` - Provider and API enablement
- ✅ `backend.tf` - GCS state backend configuration
- ✅ `state_bucket.tf` - Terraform state storage bucket
- ✅ `wif.tf` - Workload Identity Federation for GitHub Actions
- ✅ `artifact_registry.tf` - Docker registry (max 3 images retained)
- ✅ `iam.tf` - Service accounts and IAM permissions
- ✅ `secrets.tf` - Secret Manager references
- ✅ `app_engine.tf` - App Engine application resource
- ✅ `outputs.tf` - Infrastructure outputs
- ✅ `ci.auto.tfvars` - CI/CD variable values

#### Application Code Updates
- ✅ `django_apps/gcp.py` - Secret Manager integration helper
- ✅ `django_apps/settings.py` - GCP environment detection and configuration
- ✅ `google_api/utils.py` - Updated OAuth secrets path for GCP
- ✅ `requirements.txt` - Added google-cloud-secret-manager, dj-database-url, gunicorn
- ✅ `Dockerfile` - Container image for Cloud Run
- ✅ `.dockerignore` - Optimized Docker builds

#### CI/CD Workflows (`.github/workflows/`)
- ✅ `terraform.yml` - Infrastructure deployment workflow
- ✅ `deploy.yml` - Application deployment workflow

#### Documentation & Automation
- ✅ `bootstrap_gcp.sh` - Automated GCP setup script (executable)
- ✅ `DEPLOYMENT.md` - Comprehensive deployment guide
- ✅ `.gitignore` - Updated to exclude GCP_DEPLOYMENT_PLAN.md

## 🔧 Key Implementation Details

### Security Features
- **No hardcoded secrets** - All sensitive data in Secret Manager
- **Workload Identity Federation** - No service account keys in GitHub
- **SSL/TLS database connections** - Certificate stored in Secret Manager
- **Scoped IAM permissions** - Least privilege access
- **New Django SECRET_KEY** - Generated fresh (not the placeholder)

### Architecture Decisions
- **Cloud Run** - Scales to 0 when idle (min 0, max 1 instance)
- **Container-based** - Dockerfile with Python 3.12, 512Mi RAM, 1 CPU
- **Artifact Registry only** - Single source for container images (max 3 retained)
- **External PostgreSQL** - Aiven database with SSL verification
- **Automatic cleanup** - Untagged images deleted, only 3 versions kept
- **Cost optimized** - Pay only for actual usage, not idle time

### Environment Branching
The application automatically detects GCP environment:
- **Local**: Uses `private_settings.json` (gitignored)
- **GCP**: Uses Secret Manager via `GAE_APPLICATION` or `K_SERVICE` env vars

## ⚠️ Remaining Manual Steps

### 1. Install gcloud CLI (if not already installed)

**macOS:**
```bash
brew install --cask google-cloud-sdk
```

**Linux:**
```bash
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
```

Then authenticate:
```bash
gcloud auth login
gcloud config set project gmail-vercel
```

### 2. Run Bootstrap Script

```bash
cd /Users/tedis.rozenfelds/personal_data/p_projects/django-apps
./bootstrap_gcp.sh
```

This will:
- Enable Secret Manager API
- Link billing account (with confirmation prompt)
- Create all Secret Manager secrets (including new Django SECRET_KEY)
- Bootstrap Terraform state bucket
- Apply Terraform configuration
- Update workflow files with project number

**Note:** The script will prompt for confirmation before linking billing (a financial action).

### 3. Manual OAuth Configuration (After First Deploy)

After the first deployment completes, you must add the Cloud Run URL to OAuth redirect URIs:

1. Get the Cloud Run URL:
   ```bash
   gcloud run services describe django-apps --region=europe-west3 --project=gmail-vercel --format='value(status.url)'
   ```

2. Go to [GCP Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials?project=gmail-vercel)

3. Edit the OAuth 2.0 Client ID (Web application type)

4. Add to **Authorized redirect URIs**:
   ```
   https://YOUR-CLOUD-RUN-URL/google/callback
   ```

**This cannot be automated** - Google Cloud Console's OAuth client has no gcloud CLI surface for editing redirect URIs.

### 4. Commit and Push Changes

```bash
git status  # Verify GCP_DEPLOYMENT_PLAN.md is NOT staged (gitignored)

git add terraform/ .github/ django_apps/ google_api/ requirements.txt Dockerfile .dockerignore .gitignore bootstrap_gcp.sh DEPLOYMENT.md

git commit -m "Add GCP Cloud Run deployment infrastructure

- Terraform configuration for Cloud Run, Artifact Registry, WIF
- GitHub Actions workflows for automated deployment
- Updated Django settings for GCP Secret Manager integration
- Dockerfile for containerized Cloud Run deployment
- Bootstrap script for automated GCP setup
- Comprehensive deployment documentation
- Scales to 0 when idle for cost savings"

git push origin main
```

### 5. Monitor Deployment

- **GitHub Actions**: https://github.com/Ted-Rose/gmail-to-audio/actions
- **Cloud Run Console**: https://console.cloud.google.com/run?project=gmail-vercel
- **Logs**: `gcloud run services logs tail django-apps --region=europe-west3 --project=gmail-vercel`

## 📋 Verification Checklist

Before running the bootstrap script:
- [ ] gcloud CLI installed and authenticated
- [ ] Terraform CLI installed (>= 1.3)
- [ ] You have Owner/Editor permissions on gmail-vercel project
- [ ] `ca.pem` file exists in project root (for DB SSL certificate)

After running bootstrap script:
- [ ] All 6 secrets created in Secret Manager
- [ ] Terraform state bucket created
- [ ] App Engine application created (or existing one detected)
- [ ] Workflow files updated with project number
- [ ] APP_BASE_URL secret updated with real hostname

After first deployment:
- [ ] OAuth redirect URI added in GCP Console
- [ ] Application accessible at App Engine URL
- [ ] Database migrations completed
- [ ] Static files served correctly

## 🔍 Troubleshooting

### "gcloud: command not found"
Install gcloud CLI (see step 1 above).

### "Permission denied" errors
Ensure you're authenticated and have Owner/Editor role:
```bash
gcloud auth login
gcloud projects get-iam-policy gmail-vercel
```

### Terraform state lock
If Terraform gets stuck:
```bash
cd terraform
terraform force-unlock LOCK_ID
```

### Secret Manager errors
List secrets to verify they exist:
```bash
gcloud secrets list --project=gmail-vercel
```

### Deployment fails in GitHub Actions
Check that workflow files have the correct project number (not "PROJECT_NUMBER_PLACEHOLDER").

## 📊 Cost Estimate

Based on current configuration:
- **Cloud Run (0-1 instances)**: ~$5-15/month (scales to 0 when idle!)
- **Artifact Registry**: <$1/month (3 images max)
- **Secret Manager**: <$1/month (6 secrets, minimal access)
- **GCS (Terraform state)**: <$0.10/month
- **External Database**: (Aiven - separate billing)

**Total GCP cost**: ~$6-17/month 💰

**Huge savings!** Cloud Run only charges for actual request processing time. When idle (no requests), you pay nothing for compute.

## 🎯 Next Steps After Deployment

1. Monitor application logs for any issues
2. Test OAuth flow with Google authentication
3. Verify database connectivity and migrations
4. Test static file serving
5. Set up monitoring/alerting if needed
6. Consider setting up a staging environment

## 📝 Important Notes

- **GCP_DEPLOYMENT_PLAN.md is gitignored** - It contains secrets and must not be committed
- **Secrets are never in code** - All sensitive data is in Secret Manager
- **No service account keys** - GitHub Actions uses Workload Identity Federation
- **Artifact Registry cleanup is automatic** - Max 3 images retained, untagged deleted
- **Django SECRET_KEY was regenerated** - Not using the placeholder from private_settings.json

## 🆘 Support Resources

- **Deployment Guide**: `DEPLOYMENT.md`
- **GCP Documentation**: https://cloud.google.com/appengine/docs
- **Terraform Google Provider**: https://registry.terraform.io/providers/hashicorp/google/latest/docs
- **GitHub Actions**: https://docs.github.com/en/actions
