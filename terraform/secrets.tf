# Single consolidated secret: the whole .env file (KEY=VALUE lines,
# multiline values double-quoted with \n escapes). Cloud Run mounts
# it as the DOTENV env var and settings.py parses it exactly like a
# local .env file — one secret, one schema, local and cloud.
data "google_secret_manager_secret" "env_file" {
  project   = var.project_id
  secret_id = "env-file"
}
