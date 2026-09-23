data "google_secret_manager_secret" "app" {
  for_each = toset([
    "DJANGO_SECRET_KEY",
    "ESV_KEY",
    "DATABASE_URL",
    "DB_SSL_CERT",
    "GOOGLE_OAUTH_CLIENT_JSON",
    "APP_BASE_URL",
    "GOCARDLESS_SECRET_ID",
    "GOCARDLESS_SECRET_KEY",
  ])

  project   = var.project_id
  secret_id = each.value
}
