# FleetTrust production. Apply from this directory (docs/operations/environments.md):
#   terraform init -backend-config=backend.hcl
#   terraform plan -var-file=production.tfvars
#   terraform apply -var-file=production.tfvars

terraform {
  required_version = ">= 1.9"

  # State lives in a GCS bucket created once by hand (versioned, access limited to the
  # operators): it contains the generated database and Redis passwords.
  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.12"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  billing_project       = var.project_id
  user_project_override = true
}

module "fleettrust" {
  source = "../../modules/fleettrust"

  project_id        = var.project_id
  environment       = "production"
  region            = var.region
  github_repository = var.github_repository
  alert_email       = var.alert_email
  billing_account   = var.billing_account
  monthly_budget    = var.monthly_budget
  budget_currency   = var.budget_currency
  web_origins       = var.web_origins
  api_host          = var.api_host
  web_host          = var.web_host
  api_domain        = var.api_domain

  # Low-cost setup by default (docs/operations/environments.md): the Cloud SQL and Redis
  # settings below apply only with database_provider = "cloudsql" / redis_provider = "memorystore".
  database_provider = var.database_provider
  redis_provider    = var.redis_provider

  db_tier              = "db-custom-2-7680"
  db_high_availability = true
  redis_tier           = "STANDARD_HA"
  deletion_protection  = true

  image_readers = []
}
