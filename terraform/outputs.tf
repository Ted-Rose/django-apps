output "workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "github_deployer_sa_email" {
  value = google_service_account.github_deployer.email
}

output "cloud_run_url" {
  value = google_cloud_run_v2_service.django_app.uri
}

output "terraform_state_bucket" {
  value = google_storage_bucket.terraform_state.url
}

output "secret_ids_observed" {
  value = sort(keys({ for k, v in data.google_secret_manager_secret.app : k => true }))
}

output "gae_standard_image_base" {
  value = "${google_artifact_registry_repository.gae_standard.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.gae_standard.repository_id}"
}
