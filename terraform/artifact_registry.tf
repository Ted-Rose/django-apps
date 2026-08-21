resource "google_artifact_registry_repository" "gae_standard" {
  location      = var.region
  repository_id = "gae-standard"
  description   = "Sole image store for django-apps App Engine Standard deployments - Cost Optimized"
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

  # 2. KEEP Policy: Protect the most recent 3 versions from deletion
  cleanup_policies {
    id     = "keep-latest-3"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.enabled]
}
