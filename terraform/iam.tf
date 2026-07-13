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
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_cloudbuild_editor" {
  project = var.project_id
  role    = "roles/cloudbuild.builds.editor"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_storage_admin" {
  project = var.project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_artifactregistry_admin" {
  project = var.project_id
  role    = "roles/artifactregistry.admin"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_secret_admin" {
  project = var.project_id
  role    = "roles/secretmanager.admin"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_service_usage_admin" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageAdmin"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_service_account_viewer" {
  project = var.project_id
  role    = "roles/iam.serviceAccountViewer"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_service_account_creator" {
  project = var.project_id
  role    = "roles/iam.serviceAccountCreator"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
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
      resource.name.endsWith("/serviceAccounts/${local.cloudrun_email}")
    EOT
  }

  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_workload_identity_pool_viewer" {
  project = var.project_id
  role    = "roles/iam.workloadIdentityPoolViewer"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_logging_viewer" {
  project = var.project_id
  role    = "roles/logging.viewer"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "github_deployer_project_iam_admin" {
  project = var.project_id
  role    = "roles/resourcemanager.projectIamAdmin"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer]
}

resource "google_project_iam_member" "cloudrun_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cloudrun.email}"
  depends_on = [google_project_service.enabled, google_service_account.cloudrun]
}

resource "google_service_account_iam_member" "github_deployer_act_as_cloudrun" {
  service_account_id = google_service_account.cloudrun.name
  role                = "roles/iam.serviceAccountUser"
  member              = "serviceAccount:${google_service_account.github_deployer.email}"
  depends_on = [google_project_service.enabled, google_service_account.github_deployer, google_service_account.cloudrun]
}
