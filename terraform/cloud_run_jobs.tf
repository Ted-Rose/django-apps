locals {
  django_image = "${google_artifact_registry_repository.gae_standard.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.gae_standard.repository_id}/django-apps:latest"
}

resource "google_service_account" "scheduler" {
  account_id   = "cloud-scheduler"
  display_name = "Cloud Scheduler Job Invoker"
  project      = var.project_id

  depends_on = [google_project_service.enabled]
}

resource "google_cloud_run_v2_job" "sync_transactions_job" {
  name     = "sync-bank-transactions"
  location = var.region
  project  = var.project_id

  template {
    template {
      service_account = google_service_account.cloudrun.email
      containers {
        image   = local.django_image
        command = ["python", "manage.py", "sync_bank_transactions"]

        env {
          name  = "USE_GCP_SECRETS"
          value = "true"
        }
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
        env {
          name = "DJANGO_SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["DJANGO_SECRET_KEY"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["DATABASE_URL"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "APP_BASE_URL"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["APP_BASE_URL"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "GOOGLE_OAUTH_CLIENT_JSON"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["GOOGLE_OAUTH_CLIENT_JSON"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "GOCARDLESS_SECRET_ID"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["GOCARDLESS_SECRET_ID"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "GOCARDLESS_SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["GOCARDLESS_SECRET_KEY"].secret_id
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
    ignore_changes = [
      template[0].template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_project_service.enabled,
    google_artifact_registry_repository.gae_standard,
  ]
}

resource "google_cloud_run_v2_job" "evaluate_limits_job" {
  name     = "evaluate-spending-limits"
  location = var.region
  project  = var.project_id

  template {
    template {
      service_account = google_service_account.cloudrun.email
      containers {
        image   = local.django_image
        command = ["python", "manage.py", "evaluate_spending_limits"]

        env {
          name  = "USE_GCP_SECRETS"
          value = "true"
        }
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
        env {
          name = "DJANGO_SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["DJANGO_SECRET_KEY"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["DATABASE_URL"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "APP_BASE_URL"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["APP_BASE_URL"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "GOOGLE_OAUTH_CLIENT_JSON"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["GOOGLE_OAUTH_CLIENT_JSON"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "GOCARDLESS_SECRET_ID"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["GOCARDLESS_SECRET_ID"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "GOCARDLESS_SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["GOCARDLESS_SECRET_KEY"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "VAPID_PRIVATE_KEY"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["VAPID_PRIVATE_KEY"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "VAPID_SUBJECT"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.app["VAPID_SUBJECT"].secret_id
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
    ignore_changes = [
      template[0].template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_project_service.enabled,
    google_artifact_registry_repository.gae_standard,
  ]
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_invokes_sync" {
  location = google_cloud_run_v2_job.sync_transactions_job.location
  project  = var.project_id
  name     = google_cloud_run_v2_job.sync_transactions_job.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_invokes_evaluate" {
  location = google_cloud_run_v2_job.evaluate_limits_job.location
  project  = var.project_id
  name     = google_cloud_run_v2_job.evaluate_limits_job.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "sync_transactions_schedule" {
  name      = "sync-bank-transactions-schedule"
  region    = var.region
  project   = var.project_id
  schedule  = "0 2 * * *"
  time_zone = "UTC"
  paused    = true

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.sync_transactions_job.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_cloud_scheduler_job" "evaluate_limits_schedule" {
  name      = "evaluate-spending-limits-schedule"
  region    = var.region
  project   = var.project_id
  schedule  = "30 2 * * *"
  time_zone = "UTC"
  paused    = true

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.evaluate_limits_job.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.enabled]
}
