terraform {
  backend "gcs" {
    bucket = "gmail-vercel-tf-state"
    prefix = "terraform/state"
  }
}
