# FleetTrust staging. Apply from this directory (docs/operations/environments.md):
#   terraform init -backend-config=backend.hcl
#   terraform plan -var-file=staging.tfvars
#   terraform apply -var-file=staging.tfvars

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

  project_id         = var.project_id
  environment        = "staging"
  region             = var.region
  github_repository  = var.github_repository
  alert_email        = var.alert_email
  billing_account    = var.billing_account
  monthly_budget_usd = 100
  web_origins        = var.web_origins
  api_host           = var.api_host
  web_host           = var.web_host
  api_domain         = var.api_domain

  db_tier              = "db-custom-1-3840"
  db_high_availability = false
  redis_tier           = "BASIC"
  deletion_protection  = false

  # Production pulls the exact images tested here (set after production exists):
  # image_readers = [
  #   "serviceAccount:github-deployer@fleettrust-production.iam.gserviceaccount.com",
  #   "serviceAccount:service-<PRODUCTION_PROJECT_NUMBER>@serverless-robot-prod.iam.gserviceaccount.com",
  # ]
  image_readers = var.image_readers
}
