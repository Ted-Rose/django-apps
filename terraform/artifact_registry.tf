resource "google_artifact_registry_repository" "gae_standard" {
  location      = var.region
  repository_id = "gae-standard"
  description   = "Sole image store for django-apps App Engine Standard deployments."
  format        = "DOCKER"

  cleanup_policies {
    id     = "keep-latest-3"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }

  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state = "UNTAGGED"
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.enabled]
}
