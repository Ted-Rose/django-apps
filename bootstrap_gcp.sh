#!/bin/bash
set -e

# GCP Deployment Bootstrap Script for django-apps
# This script automates the GCP deployment setup as per GCP_DEPLOYMENT_PLAN.md
# 
# Prerequisites:
# - gcloud CLI installed and authenticated (gcloud auth login)
# - terraform CLI installed
# - gh CLI installed and authenticated (gh auth login)
# - You must have Owner/Editor permissions on gmail-vercel project

PROJECT_ID="gmail-vercel"
REGION="europe-west3"

echo "=== GCP Deployment Bootstrap for django-apps ==="
echo ""
echo "This script will:"
echo "1. Link billing account (requires confirmation)"
echo "2. Enable Secret Manager API"
echo "3. Create Secret Manager secrets"
echo "4. Bootstrap Terraform state bucket"
echo "5. Build and push initial Docker image"
echo "6. Apply Terraform configuration (creates Cloud Run service)"
echo "7. Update workflow files with project number"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

# Step 1: Link billing account (MUST be done before enabling APIs)
echo ""
echo "=== Step 1: Linking Billing Account ==="
echo "Fetching billing account from bible-research-489314..."
BILLING_ACCOUNT=$(gcloud beta billing projects describe bible-research-489314 --format='value(billingAccountName)')
echo "Billing account: $BILLING_ACCOUNT"
echo ""
echo "⚠️  This will link billing to $PROJECT_ID (a real financial action)"
read -p "Proceed with billing link? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
    echo "✓ Billing linked"
else
    echo "⚠️  Skipping billing link - you'll need to do this manually"
    echo "You can link it manually at: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
    exit 1
fi

# Step 2: Enable Secret Manager API
echo ""
echo "=== Step 2: Enabling Secret Manager API ==="
gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"

# Step 3: Create Secret Manager secrets
echo ""
echo "=== Step 3: Creating Secret Manager Secrets ==="

# Generate a new Django secret key
echo "Generating new Django SECRET_KEY..."
DJANGO_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")
printf '%s' "$DJANGO_SECRET_KEY" | gcloud secrets create DJANGO_SECRET_KEY \
    --project="$PROJECT_ID" \
    --data-file=- \
    --replication-policy=automatic \
    2>/dev/null && echo "✓ Created DJANGO_SECRET_KEY" || echo "⚠️  DJANGO_SECRET_KEY already exists"

# ESV_KEY
read -rsp "Enter ESV_KEY value: " ESV_KEY_VALUE
echo
printf '%s' "$ESV_KEY_VALUE" | gcloud secrets create ESV_KEY \
    --project="$PROJECT_ID" \
    --data-file=- \
    --replication-policy=automatic \
    2>/dev/null && echo "✓ Created ESV_KEY" || echo "⚠️  ESV_KEY already exists"

# DATABASE_URL
read -rsp "Enter DATABASE_URL (postgresql://user:pass@host:port/db): " DATABASE_URL_VALUE
echo
printf '%s' "$DATABASE_URL_VALUE" | gcloud secrets create DATABASE_URL \
    --project="$PROJECT_ID" \
    --data-file=- \
    --replication-policy=automatic \
    2>/dev/null && echo "✓ Created DATABASE_URL" || echo "⚠️  DATABASE_URL already exists"

# DB_SSL_CERT (from ca.pem file)
if [ -f "ca.pem" ]; then
    gcloud secrets create DB_SSL_CERT \
        --project="$PROJECT_ID" \
        --data-file=./ca.pem \
        --replication-policy=automatic \
        2>/dev/null && echo "✓ Created DB_SSL_CERT" || echo "⚠️  DB_SSL_CERT already exists"
else
    echo "⚠️  ca.pem not found - skipping DB_SSL_CERT"
fi

# GOOGLE_OAUTH_CLIENT_JSON
echo "Enter GOOGLE_OAUTH_CLIENT_JSON value (paste the full JSON, then press Enter + Ctrl+D):"
GOOGLE_OAUTH_CLIENT_JSON_VALUE=$(cat)
printf '%s' "$GOOGLE_OAUTH_CLIENT_JSON_VALUE" | gcloud secrets create GOOGLE_OAUTH_CLIENT_JSON \
    --project="$PROJECT_ID" \
    --data-file=- \
    --replication-policy=automatic \
    2>/dev/null && echo "✓ Created GOOGLE_OAUTH_CLIENT_JSON" || echo "⚠️  GOOGLE_OAUTH_CLIENT_JSON already exists"

# APP_BASE_URL (placeholder, will be updated after first deploy)
printf '%s' 'https://127.0.0.1:8000' | gcloud secrets create APP_BASE_URL \
    --project="$PROJECT_ID" \
    --data-file=- \
    --replication-policy=automatic \
    2>/dev/null && echo "✓ Created APP_BASE_URL (placeholder)" || echo "⚠️  APP_BASE_URL already exists"

# Step 4: Bootstrap Terraform state bucket
echo ""
echo "=== Step 4: Bootstrapping Terraform State Bucket ==="
cd terraform

# Temporarily remove backend config for initial bucket creation
if [ -f "backend.tf" ]; then
    mv backend.tf backend.tf.bak
    echo "Temporarily disabled remote backend"
fi

terraform init
echo "Creating state bucket..."
terraform apply -target=google_storage_bucket.terraform_state -auto-approve

# Restore backend config and migrate state
if [ -f "backend.tf.bak" ]; then
    mv backend.tf.bak backend.tf
    echo "Restored backend configuration"
fi

echo "Migrating state to GCS..."
terraform init -migrate-state -force-copy

# Step 5: Build and push initial Docker image
echo ""
echo "=== Step 5: Building and Pushing Initial Docker Image ==="
cd ..

# Configure Docker for Artifact Registry
gcloud auth configure-docker ${REGION}-docker.pkg.dev

# Build the Docker image
echo "Building Docker image..."
docker build --platform linux/amd64 -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/gae-standard/django-apps:latest .

# Push the Docker image
echo "Pushing Docker image to Artifact Registry..."
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/gae-standard/django-apps:latest

echo "✓ Initial Docker image pushed"

cd terraform

# Step 6: Apply full Terraform configuration
echo ""
echo "=== Step 6: Applying Terraform Configuration ==="
terraform apply -auto-approve

# Get project number for workflow files
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
echo ""
echo "✓ Terraform applied successfully"
echo "Project Number: $PROJECT_NUMBER"

cd ..

# Step 7: Update workflow files with project number
echo ""
echo "=== Step 7: Updating GitHub Actions Workflow Files ==="
sed -i.bak "s/PROJECT_NUMBER_PLACEHOLDER/$PROJECT_NUMBER/g" .github/workflows/terraform.yml
sed -i.bak "s/PROJECT_NUMBER_PLACEHOLDER/$PROJECT_NUMBER/g" .github/workflows/deploy.yml
rm -f .github/workflows/*.bak
echo "✓ Updated workflow files with project number: $PROJECT_NUMBER"

# Step 8: Get Cloud Run URL (after first deploy)
echo ""
echo "=== Step 8: Cloud Run URL ==="
cd terraform
CLOUD_RUN_URL=$(terraform output -raw cloud_run_url 2>/dev/null || echo "")
cd ..

if [ -n "$CLOUD_RUN_URL" ]; then
    echo "Cloud Run URL: $CLOUD_RUN_URL"
    echo ""
    echo "Updating APP_BASE_URL secret..."
    printf '%s' "$CLOUD_RUN_URL" | gcloud secrets versions add APP_BASE_URL \
        --project="$PROJECT_ID" \
        --data-file=-
    echo "✓ Updated APP_BASE_URL secret"
else
    echo "⚠️  Cloud Run service not deployed yet"
    echo "After first deployment, run:"
    echo "  cd terraform && terraform output -raw cloud_run_url"
    echo "Then update the secret with:"
    echo "  printf '%s' 'https://CLOUD_RUN_URL' | gcloud secrets versions add APP_BASE_URL --project=$PROJECT_ID --data-file=-"
fi

# Final instructions
echo ""
echo "=== Bootstrap Complete! ==="
echo ""
echo "Next steps:"
echo "1. Review and commit changes:"
echo "   git add terraform/ .github/ django_apps/ google_api/ requirements.txt Dockerfile .dockerignore .gitignore"
echo "   git commit -m 'Add GCP Cloud Run deployment configuration'"
echo ""
echo "2. Push to trigger deployment:"
echo "   git push origin main"
echo ""
echo "3. After deployment, get Cloud Run URL and update OAuth:"
echo "   - Get URL: gcloud run services describe django-apps --region=$REGION --project=$PROJECT_ID --format='value(status.url)'"
echo "   - Add to OAuth redirect URIs: https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
echo "   - Add: YOUR_CLOUD_RUN_URL/google/callback"
echo ""
echo "4. Monitor deployment:"
echo "   - GitHub Actions: https://github.com/Ted-Rose/gmail-to-audio/actions"
echo "   - Cloud Run: https://console.cloud.google.com/run?project=$PROJECT_ID"
echo ""
echo "💰 Cost savings: Cloud Run scales to 0 when idle (no requests = no cost!)"
echo "⚠️  Remember: GCP_DEPLOYMENT_PLAN.md is gitignored and contains secrets - keep it safe!"
