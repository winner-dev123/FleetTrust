# FleetTrust environment: everything except the Cloud Run services themselves, which the release
# workflows deploy from deploy/cloudrun/*.yaml (so a release never needs a Terraform apply).
# See docs/operations/environments.md.

locals {
  name   = "fleettrust-${var.environment}"
  is_prd = var.environment == "production"
  labels = {
    app         = "fleettrust"
    environment = var.environment
    managed-by  = "terraform"
  }
}

data "google_project" "this" {
  project_id = var.project_id
}

resource "google_project_service" "apis" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudtrace.googleapis.com",
    "compute.googleapis.com",
    "firebase.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "firebaseapphosting.googleapis.com",
    "fcm.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "identitytoolkit.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "redis.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
    "billingbudgets.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
