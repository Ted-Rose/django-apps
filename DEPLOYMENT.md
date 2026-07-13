# GCP App Engine Deployment Guide

This document provides instructions for deploying the django-apps application to Google Cloud Platform App Engine.

## Architecture Overview

- **Platform**: Google App Engine Standard (Python 3.12)
- **Database**: Aiven PostgreSQL (external, SSL-enabled)
- **Secrets**: Google Secret Manager
- **Infrastructure**: Terraform-managed
- **CI/CD**: GitHub Actions with Workload Identity Federation
- **Container Registry**: Artifact Registry (max 3 image versions retained)

## Prerequisites

Before running the bootstrap script, ensure you have:

1. **gcloud CLI** installed and authenticated
   ```bash
   gcloud auth login
   gcloud config set project gmail-vercel
   ```

2. **Terraform CLI** installed (version >= 1.3)
   ```bash
   brew install terraform  # macOS
   ```

3. **GitHub CLI** installed and authenticated
   ```bash
   gh auth login
   ```

4. **Permissions**: Owner or Editor role on the `gmail-vercel` GCP project

## Quick Start

Run the automated bootstrap script:

```bash
./bootstrap_gcp.sh
```

This script will:
1. Enable required GCP APIs
2. Link billing account (with confirmation)
3. Create Secret Manager secrets
4. Bootstrap Terraform state bucket
5. Apply Terraform configuration
6. Update GitHub Actions workflows with project number

## Manual Steps Required

### 1. Update OAuth Redirect URIs

After the first deployment, add the App Engine URL to your OAuth client:

1. Go to [GCP Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials?project=gmail-vercel)
2. Edit the OAuth 2.0 Client ID
3. Add to Authorized redirect URIs:
   ```
   https://gmail-vercel.ew.r.appspot.com/google/callback
   ```
   (Replace with your actual App Engine hostname)

### 2. First Deployment

After committing and pushing the changes:

```bash
git add terraform/ .github/ django_apps/ google_api/ requirements.txt app.yaml .gitignore
git commit -m "Add GCP App Engine deployment configuration"
git push origin main
```

GitHub Actions will automatically:
- Run Terraform to ensure infrastructure is up-to-date
- Deploy the application to App Engine
- Run database migrations
- Collect static files

## Project Structure

```
django-apps/
├── terraform/              # Infrastructure as Code
│   ├── main.tf            # Provider and API configuration
│   ├── variables.tf       # Input variables
│   ├── backend.tf         # GCS state backend
│   ├── state_bucket.tf    # Terraform state storage
│   ├── wif.tf             # Workload Identity Federation
│   ├── artifact_registry.tf  # Container registry (max 3 images)
│   ├── iam.tf             # Service accounts and permissions
│   ├── secrets.tf         # Secret Manager references
│   ├── app_engine.tf      # App Engine application
│   └── outputs.tf         # Output values
├── .github/workflows/
│   ├── terraform.yml      # Infrastructure deployment
│   └── deploy.yml         # Application deployment
├── django_apps/
│   ├── gcp.py            # GCP Secret Manager integration
│   └── settings.py       # Updated for GCP environment
├── app.yaml              # App Engine configuration
└── bootstrap_gcp.sh      # Automated setup script
```

## Environment Configuration

The application automatically detects the GCP environment using:
- `GAE_APPLICATION` environment variable (App Engine)
- `K_SERVICE` environment variable (Cloud Run, if needed)

### Local Development

Local development continues to use `private_settings.json` (gitignored):
```json
{
  "SECRET_KEY": "...",
  "DEBUG": true,
  "DATABASES": { ... },
  "ESV_KEY": "...",
  "BASE_URL": "http://127.0.0.1:8000"
}
```

### Production (GCP)

Production uses Secret Manager for all sensitive configuration:
- `DJANGO_SECRET_KEY` - Django secret key (auto-generated)
- `DATABASE_URL` - PostgreSQL connection string
- `DB_SSL_CERT` - Database SSL certificate
- `ESV_KEY` - ESV Bible API key
- `GOOGLE_OAUTH_CLIENT_JSON` - OAuth client credentials
- `APP_BASE_URL` - Application base URL

## Secrets Management

### Creating/Updating Secrets

```bash
# Create a new secret
echo -n "secret-value" | gcloud secrets create SECRET_NAME \
  --project=gmail-vercel \
  --data-file=- \
  --replication-policy=automatic

# Update existing secret
echo -n "new-value" | gcloud secrets versions add SECRET_NAME \
  --project=gmail-vercel \
  --data-file=-

# View secret (requires secretAccessor role)
gcloud secrets versions access latest --secret=SECRET_NAME --project=gmail-vercel
```

### Rotating Secrets

To rotate the Django secret key:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(50))" | \
  gcloud secrets versions add DJANGO_SECRET_KEY --project=gmail-vercel --data-file=-
```

Then redeploy the application.

## Terraform Management

### Viewing Infrastructure

```bash
cd terraform
terraform plan    # Preview changes
terraform apply   # Apply changes
terraform output  # View outputs
```

### Important Outputs

```bash
terraform output app_engine_default_hostname  # App Engine URL
terraform output github_deployer_sa_email     # Deployer service account
terraform output workload_identity_provider   # WIF provider for GitHub Actions
```

## Monitoring and Logs

### View Application Logs

```bash
# Recent logs
gcloud app logs tail --project=gmail-vercel

# Specific service logs
gcloud app logs read --service=default --project=gmail-vercel
```

### View Deployments

```bash
# List versions
gcloud app versions list --project=gmail-vercel

# Describe specific version
gcloud app versions describe VERSION_ID --project=gmail-vercel
```

### Access App Engine Console

https://console.cloud.google.com/appengine?project=gmail-vercel

## Troubleshooting

### Deployment Fails with "Secret not found"

Ensure all secrets are created:
```bash
gcloud secrets list --project=gmail-vercel
```

Expected secrets:
- DJANGO_SECRET_KEY
- DATABASE_URL
- DB_SSL_CERT
- ESV_KEY
- GOOGLE_OAUTH_CLIENT_JSON
- APP_BASE_URL

### Database Connection Issues

Verify the database SSL certificate is correctly stored:
```bash
gcloud secrets versions access latest --secret=DB_SSL_CERT --project=gmail-vercel
```

### OAuth Callback Errors

Ensure the App Engine URL is added to OAuth redirect URIs in GCP Console.

### Terraform State Lock

If Terraform state is locked:
```bash
# Force unlock (use with caution)
cd terraform
terraform force-unlock LOCK_ID
```

## Cost Optimization

Current configuration:
- **App Engine**: F1 instance class, 1 min/max instance (always-on)
- **Artifact Registry**: Max 3 images retained (automatic cleanup)
- **Secret Manager**: Pay per access (minimal cost)
- **Storage**: GCS for Terraform state only

To reduce costs:
- Set `min_instances: 0` in `app.yaml` (adds cold start latency)
- Use F2 or higher instance class for better performance (higher cost)

## Security Notes

1. **Never commit secrets** - All secrets are in Secret Manager or gitignored files
2. **WIF authentication** - No service account keys stored in GitHub
3. **Least privilege IAM** - Service accounts have scoped permissions
4. **SSL/TLS** - Database connections use SSL verification
5. **Secret rotation** - Secrets can be rotated without code changes

## Rollback Procedure

To rollback to a previous version:

```bash
# List versions
gcloud app versions list --project=gmail-vercel

# Route traffic to previous version
gcloud app services set-traffic default \
  --splits=VERSION_ID=1 \
  --project=gmail-vercel
```

Or use the GCP Console to split/migrate traffic.

## Support

For issues or questions:
- Check GitHub Actions logs: https://github.com/Ted-Rose/gmail-to-audio/actions
- Review GCP logs: `gcloud app logs tail`
- Consult GCP_DEPLOYMENT_PLAN.md (gitignored, contains detailed implementation notes)
