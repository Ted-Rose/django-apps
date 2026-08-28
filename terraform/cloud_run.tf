resource "google_cloud_run_v2_service" "django_app" {
  name     = "django-apps"
  location = var.region
  project  = var.project_id

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      image = "${google_artifact_registry_repository.gae_standard.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.gae_standard.repository_id}/django-apps:latest"

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
        name = "ESV_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.app["ESV_KEY"].secret_id
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
        name  = "GCS_AUDIO_BUCKET"
        value = google_storage_bucket.audio_recordings.name
      }

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }

    service_account = local.cloudrun_email
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_project_service.enabled,
    google_artifact_registry_repository.gae_standard,
  ]
}

resource "google_cloud_run_service_iam_member" "public_access" {
  location = google_cloud_run_v2_service.django_app.location
  project  = google_cloud_run_v2_service.django_app.project
  service  = google_cloud_run_v2_service.django_app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
