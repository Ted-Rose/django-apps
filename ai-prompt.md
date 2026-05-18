Act as an expert Cloud Infrastructure and DevOps Engineer. You are currently executing within the root directory of a Python Django API application. This directory already contains the application source code and a Dockerfile.

Your goal is to generate a complete infrastructure-as-code setup and CI/CD configuration to deploy this Django API to Google Cloud Run.

Here are my project details:

- GCP Project ID: [django-apps-7345]
- GCP Region: [europe-north1]
- Cloud Run Service Name: [django-prod]
- Artifact Registry Repo Name: [https://hub.docker.com/repository/docker/tedisrozenfelds/django-apps]

Please provide the following deliverables:

1. Terraform Code (main.tf):
- Configure the Google provider using the project and region specified above.
- Create a Google Artifact Registry Docker repository if it doesn't already exist.
- Create a Google Cloud Run (v2) service. For the initial deployment, use a placeholder image (like 'us-docker.pkg.dev/cloudrun/container/hello:latest').
- CRITICAL SCALE SETTINGS: Configure the Cloud Run service scaling so that 'min_instance_count = 0' (to scale down to zero when idle) and 'max_instance_count = 1' (to strictly limit capacity to a maximum of 1 instance).
- Configure the container to listen on port 8080 (standard for Cloud Run) and ensure it passes the PORT environment variable if needed by Django/Gunicorn.
- Allow unauthenticated (public) traffic to the Cloud Run service so the API is accessible.

2. GitHub Actions CI/CD Workflow File (.github/workflows/deploy.yml):
- Trigger the workflow on every push to the 'main' branch.
- Use Google Workload Identity Federation to securely authenticate GitHub with GCP without using permanent service account keys.
- Set up Docker buildx.
- Authenticate Docker with the Google Artifact Registry repository created by Terraform.
- Build, tag, and push the local Django Dockerfile (located in the current directory) to the Artifact Registry.
- Deploy the newly pushed image to the Cloud Run service, maintaining the min=0 and max=1 scaling constraints.

Ensure all files are complete, heavily commented, and explicitly assume that the build context for Docker is the current directory where this script is being run.