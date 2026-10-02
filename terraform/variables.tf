variable "project_id" {
  type    = string
  default = "django-apps-7345"
}

variable "region" {
  type        = string
  default     = "europe-west3"
  description = "Default provider region. App Engine and Artifact Registry use this region."
}

variable "github_repo" {
  type    = string
  default = "Ted-Rose/django-apps"
}
