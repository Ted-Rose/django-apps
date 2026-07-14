#!/bin/bash
set -e

# ============================================================
# FILL IN THESE VALUES BEFORE RUNNING
# ============================================================
OLD_PROJECT_ID="gmail-vercel"
NEW_PROJECT_ID="django-apps"
NEW_PROJECT_NUMBER=""          # gcloud projects describe django-apps --format='value(projectNumber)'
OLD_STATE_BUCKET="gmail-vercel-tf-state"
NEW_STATE_BUCKET="django-apps-tf-state"
REGION="europe-west3"
GITHUB_REPO="Ted-Rose/django-apps"
# ============================================================

# Validate required variables
if [ -z "$NEW_PROJECT_NUMBER" ]; then
    echo "ERROR: NEW_PROJECT_NUMBER is not set."
    echo "Run: gcloud projects describe $NEW_PROJECT_ID --format='value(projectNumber)'"
    exit 1
fi

echo "=== Migration: $OLD_PROJECT_ID → $NEW_PROJECT_ID ==="
echo ""
echo "Settings:"
echo "  Old project : $OLD_PROJECT_ID"
echo "  New project : $NEW_PROJECT_ID ($NEW_PROJECT_NUMBER)"
echo "  Old bucket  : $OLD_STATE_BUCKET"
echo "  New bucket  : $NEW_STATE_BUCKET"
echo "  Region      : $REGION"
echo "  GitHub repo : $GITHUB_REPO"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

# ============================================================
# Phase 2: Update all code references
# ============================================================
echo ""
echo "=== Updating code references ==="

# terraform/ci.auto.tfvars
sed -i.bak "s/project_id  = \"$OLD_PROJECT_ID\"/project_id  = \"$NEW_PROJECT_ID\"/" terraform/ci.auto.tfvars
echo "✓ terraform/ci.auto.tfvars"

# terraform/variables.tf
sed -i.bak "s/default = \"$OLD_PROJECT_ID\"/default = \"$NEW_PROJECT_ID\"/" terraform/variables.tf
echo "✓ terraform/variables.tf"

# terraform/backend.tf
sed -i.bak "s/bucket = \"$OLD_STATE_BUCKET\"/bucket = \"$NEW_STATE_BUCKET\"/" terraform/backend.tf
echo "✓ terraform/backend.tf"

# terraform/state_bucket.tf
sed -i.bak "s/name.*= \"$OLD_STATE_BUCKET\"/name                        = \"$NEW_STATE_BUCKET\"/" terraform/state_bucket.tf
echo "✓ terraform/state_bucket.tf"

# .github/workflows/deploy.yml
sed -i.bak \
    -e "s|GCP_PROJECT_ID: $OLD_PROJECT_ID|GCP_PROJECT_ID: $NEW_PROJECT_ID|g" \
    -e "s|projects/[0-9]*/locations/global/workloadIdentityPools/github-actions/providers/github|projects/$NEW_PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/providers/github|g" \
    -e "s|github-deployer@$OLD_PROJECT_ID.iam.gserviceaccount.com|github-deployer@$NEW_PROJECT_ID.iam.gserviceaccount.com|g" \
    -e "s|$REGION-docker.pkg.dev/$OLD_PROJECT_ID/gae-standard|$REGION-docker.pkg.dev/$NEW_PROJECT_ID/gae-standard|g" \
    .github/workflows/deploy.yml
echo "✓ .github/workflows/deploy.yml"

# .github/workflows/terraform.yml
sed -i.bak \
    -e "s|GCP_PROJECT_ID: $OLD_PROJECT_ID|GCP_PROJECT_ID: $NEW_PROJECT_ID|g" \
    -e "s|projects/[0-9]*/locations/global/workloadIdentityPools/github-actions/providers/github|projects/$NEW_PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/providers/github|g" \
    -e "s|github-deployer@$OLD_PROJECT_ID.iam.gserviceaccount.com|github-deployer@$NEW_PROJECT_ID.iam.gserviceaccount.com|g" \
    .github/workflows/terraform.yml
echo "✓ .github/workflows/terraform.yml"

# bootstrap_gcp.sh
sed -i.bak "s/PROJECT_ID=\"$OLD_PROJECT_ID\"/PROJECT_ID=\"$NEW_PROJECT_ID\"/" bootstrap_gcp.sh
echo "✓ bootstrap_gcp.sh"

# Remove .bak files
find . -name "*.bak" -not -path "./.git/*" -delete
echo ""
echo "✓ All references updated"

# ============================================================
# Phase 3: Bootstrap django-apps
# ============================================================
echo ""
echo "=== Next step: run bootstrap_gcp.sh ==="
echo ""
echo "This will set up secrets, Terraform state, and deploy to Cloud Run."
echo ""
read -p "Run bootstrap_gcp.sh now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    bash bootstrap_gcp.sh
else
    echo ""
    echo "Run it manually when ready:"
    echo "  bash bootstrap_gcp.sh"
fi
