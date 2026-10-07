locals {
  cloudrun_email = "cloudrun-sa@${var.project_id}.iam.gserviceaccount.com"
}

resource "google_service_account" "cloudrun" {
  account_id   = "cloudrun-sa"
  display_name = "Cloud Run Service Account"
  description  = "Service account for django-apps Cloud Run service"
  project      = var.project_id

  depends_on = [google_project_service.enabled]
}

resource "google_service_account" "github_deployer" {
  account_id   = "github-deployer"
  display_name = "github-deployer"
  description  = "Account that manages deployments for django-apps"
  project      = var.project_id

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "github_deployer_run_admin" {
  project    = var.project_id
  role       = "roles/run.admin"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_cloudbuild_editor" {
  project    = var.project_id
  role       = "roles/cloudbuild.builds.editor"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_sa_user" {
  project    = var.project_id
  role       = "roles/iam.serviceAccountUser"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_storage_admin" {
  project    = var.project_id
  role       = "roles/storage.admin"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_artifactregistry_admin" {
  project    = var.project_id
  role       = "roles/artifactregistry.admin"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_secret_admin" {
  project    = var.project_id
  role       = "roles/secretmanager.admin"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_service_usage_admin" {
  project    = var.project_id
  role       = "roles/serviceusage.serviceUsageAdmin"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_service_account_viewer" {
  project    = var.project_id
  role       = "roles/iam.serviceAccountViewer"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_service_account_creator" {
  project    = var.project_id
  role       = "roles/iam.serviceAccountCreator"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_service_account_admin_scoped" {
  project = var.project_id
  role    = "roles/iam.serviceAccountAdmin"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"

  condition {
    title       = "Terraform-managed SAs only"
    description = "Limits serviceAccountAdmin to SAs defined in this Terraform config."
    expression  = <<-EOT
      resource.name.endsWith("/serviceAccounts/github-deployer@${var.project_id}.iam.gserviceaccount.com") ||
      resource.name.endsWith("/serviceAccounts/${local.cloudrun_email}") ||
      resource.name.endsWith("/serviceAccounts/cloud-scheduler@${var.project_id}.iam.gserviceaccount.com") ||
      resource.name.endsWith("/serviceAccounts/vercel-audio@${var.project_id}.iam.gserviceaccount.com")
    EOT
  }

  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_workload_identity_pool_viewer" {
  project    = var.project_id
  role       = "roles/iam.workloadIdentityPoolViewer"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_logging_viewer" {
  project    = var.project_id
  role       = "roles/logging.viewer"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_cloudscheduler_admin" {
  project    = var.project_id
  role       = "roles/cloudscheduler.admin"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_project_iam_admin" {
  project    = var.project_id
  role       = "roles/resourcemanager.projectIamAdmin"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "cloudrun_secret_accessor" {
  project    = var.project_id
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.cloudrun.email}"
  depends_on = [google_project_service.enabled, google_service_account.cloudrun]
}

resource "google_service_account_iam_member" "github_deployer_act_as_cloudrun" {
  service_account_id = google_service_account.cloudrun.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on         = [google_project_service.enabled, google_service_account.github_deployer, google_service_account.cloudrun]
}

# Cloud Run SA can write audio files to bucket
resource "google_storage_bucket_iam_member" "cloudrun_audio_object_creator" {
  bucket = google_storage_bucket.audio_recordings.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.cloudrun.email}"
}

# Cloud Run SA can read audio files (for signed URL generation)
resource "google_storage_bucket_iam_member" "cloudrun_audio_object_viewer" {
  bucket = google_storage_bucket.audio_recordings.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.cloudrun.email}"
}

# Cloud Run SA needs to sign blobs for generating signed URLs
# This allows the SA to sign on its own behalf
resource "google_service_account_iam_member" "cloudrun_self_token_creator" {
  service_account_id = google_service_account.cloudrun.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.cloudrun.email}"
  depends_on = [
    google_project_service.enabled,
    google_service_account.cloudrun
  ]
}

# Vercel lambdas have no GCP identity (no metadata server), so audio
# uploads there authenticate as this dedicated SA via a JSON key in
# the GCP_SERVICE_ACCOUNT_JSON env var.
resource "google_service_account" "vercel_audio" {
  account_id   = "vercel-audio"
  display_name = "Vercel audio (TTS uploads)"
  description  = "Used by the Vercel deployment to upload TTS audio to GCS"
  project      = var.project_id

  depends_on = [google_project_service.enabled]
}

# Vercel SA can upload audio files; signed-URL reads need no IAM —
# the URL signature itself authorizes the GET.
resource "google_storage_bucket_iam_member" "vercel_audio_object_creator" {
  bucket = google_storage_bucket.audio_recordings.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.vercel_audio.email}"
}

# objectViewer so blob.exists() can check whether the audio was
# already generated (content-addressed dedup in text_to_audio).
resource "google_storage_bucket_iam_member" "vercel_audio_object_viewer" {
  bucket = google_storage_bucket.audio_recordings.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.vercel_audio.email}"
}

# Lets the deployer create the vercel-audio key. This must be a
# per-SA binding: the project-level serviceAccountAdmin condition
# above matches on the SA's email form, but serviceAccountKeys.*
# calls address the SA by unique_id, so a conditioned grant never
# applies to them.
resource "google_service_account_iam_member" "github_deployer_key_admin_vercel_audio" {
  service_account_id = google_service_account.vercel_audio.name
  role               = "roles/iam.serviceAccountKeyAdmin"
  member             = "serviceAccount:${google_service_account.github_deployer.email}"
}

# JSON key — consumed as the GCP_SERVICE_ACCOUNT_JSON env var on
# Vercel (terraform output -raw vercel_audio_sa_key_json).
resource "google_service_account_key" "vercel_audio" {
  service_account_id = google_service_account.vercel_audio.name
  depends_on = [
    google_service_account_iam_member.github_deployer_key_admin_vercel_audio,
  ]
}
