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

      # Env order matches what `gcloud run deploy` leaves behind
      # (deploy.yml is the source of truth — it puts the
      # secret-backed var first); ordering here only avoids a
      # perpetual no-op diff.
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

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "GCS_AUDIO_BUCKET"
        value = google_storage_bucket.audio_recordings.name
      }

      ports {
        container_port = 8080
      }

      resources {
        cpu_idle = true
        limits = {
          cpu = "1"
          # Keep in sync with deploy.yml's `gcloud run deploy
          # --memory=1Gi` — the workflow is the source of truth.
          memory = "1Gi"
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
    # image is owned by deploy.yml's `gcloud run deploy`;
    # client/client_version are gcloud-stamped annotations the
    # same deploy rewrites every run — ignoring them avoids a
    # perpetual no-op diff.
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.enabled,
    google_artifact_registry_repository.gae_standard,
    google_service_account.cloudrun,
    google_project_iam_member.cloudrun_secret_accessor,
  ]
}

resource "google_cloud_run_service_iam_member" "public_access" {
  location = google_cloud_run_v2_service.django_app.location
  project  = google_cloud_run_v2_service.django_app.project
  service  = google_cloud_run_v2_service.django_app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
