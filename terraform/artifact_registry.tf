resource "google_artifact_registry_repository" "gae_standard" {
  location      = var.region
  repository_id = "gae-standard"
  description   = "Image store for the django-apps Cloud Run service"
  format        = "DOCKER"

  # 1. DELETE Policy: Target ALL images older than 1 day
  cleanup_policies {
    id     = "delete-old-versions"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "86400s" # 24 Hours
    }
  }

  # 2. KEEP Policy: Protect only the most recent version from deletion
  cleanup_policies {
    id     = "keep-latest-1"
    action = "KEEP"
    most_recent_versions {
      keep_count = 1
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.enabled]
}
