locals {
  django_image = "${google_artifact_registry_repository.gae_standard.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.gae_standard.repository_id}/django-apps:latest"
}

resource "google_service_account" "scheduler" {
  account_id   = "cloud-scheduler"
  display_name = "Cloud Scheduler Job Invoker"
  project      = var.project_id

  depends_on = [google_project_service.enabled]
}

# Master job: runs the JOBS list in
# django_apps/management/commands/run_all_jobs.py in one pass.
# That JOBS list is the single place sub-jobs are
# enabled/disabled — there are no per-task Cloud Run jobs or
# per-task scheduler triggers anymore.
resource "google_cloud_run_v2_job" "all_jobs" {
  name     = "all-jobs"
  location = var.region
  project  = var.project_id

  template {
    template {
      service_account = google_service_account.cloudrun.email
      timeout         = "3600s"
      containers {
        image   = local.django_image
        command = ["python", "manage.py", "run_all_jobs"]

        env {
          name  = "USE_GCP_SECRETS"
          value = "true"
        }
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
        # All app secrets ship in one mounted value: the env-file
        # secret holds a complete .env file which settings.py parses.
        env {
          name = "DOTENV"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.env_file.secret_id
              version = "latest"
            }
          }
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }
      }
    }
  }

  lifecycle {
    # image is owned by deploy.yml's `gcloud run jobs update`;
    # client/client_version are gcloud-stamped annotations the
    # same command rewrites every run — ignoring them avoids a
    # perpetual no-op diff.
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.enabled,
    google_artifact_registry_repository.gae_standard,
    google_project_iam_member.cloudrun_secret_accessor,
  ]
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_invokes_all_jobs" {
  location = google_cloud_run_v2_job.all_jobs.location
  project  = var.project_id
  name     = google_cloud_run_v2_job.all_jobs.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

# One Cloud Scheduler trigger runs the master job daily at 03:00
# UTC (the old check-balance-alerts slot). Which sub-jobs actually
# run is controlled by the JOBS list in
# django_apps/management/commands/run_all_jobs.py, not here.
# To pause without destroying infra, set paused = true.
# DB migrations are unaffected — deploy.yml runs them via a one-off
# django-migrate-<sha> Cloud Run job on each deploy.
resource "google_cloud_scheduler_job" "all_jobs_schedule" {
  name      = "all-jobs-daily"
  region    = var.region
  project   = var.project_id
  schedule  = "0 3 * * *"
  time_zone = "UTC"
  paused    = false

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.all_jobs.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.enabled]
}
