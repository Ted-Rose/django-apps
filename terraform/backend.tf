terraform {
  backend "gcs" {
    bucket = "django-apps-7345-tf-state"
    prefix = "terraform/state"
  }
}
