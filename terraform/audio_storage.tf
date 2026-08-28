# GCS bucket for audio recordings with 7-day lifecycle
resource "google_storage_bucket" "audio_recordings" {
  name                        = "${var.project_id}-audio-recordings"
  location                    = upper(var.region)
  project                     = var.project_id
  force_destroy               = true
  uniform_bucket_level_access = true

  # Automatic deletion after 7 days
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }

  # CORS configuration for browser access
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.enabled]
}
