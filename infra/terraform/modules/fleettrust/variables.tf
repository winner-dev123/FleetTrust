# Inputs for one FleetTrust environment (one Google Cloud project per environment, ADR-0036).

variable "project_id" {
  description = "Google Cloud project for this environment (e.g. fleettrust-staging)."
  type        = string
}

variable "environment" {
  description = "staging or production. Sets names, sizes and protections."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "region" {
  description = "Region for all regional resources (OQ-02: Europe chosen)."
  type        = string
  default     = "europe-west1"
}

variable "github_repository" {
  description = "owner/name of the repository allowed to deploy (Workload Identity Federation)."
  type        = string
}

variable "alert_email" {
  description = "Where alerts and budget warnings go."
  type        = string
}

variable "billing_account" {
  description = "Billing account ID (XXXXXX-XXXXXX-XXXXXX) for the budget alert. Empty skips the budget."
  type        = string
  default     = ""
}

variable "monthly_budget" {
  description = "Monthly budget for this project (OQ-07), in budget_currency. Alerts at 50, 90 and 100 %."
  type        = number
  default     = 100
}

variable "budget_currency" {
  description = "Currency of the budget. Must be the billing account's own currency (Google rejects any other)."
  type        = string
  default     = "USD"

  validation {
    condition     = can(regex("^[A-Z]{3}$", var.budget_currency))
    error_message = "budget_currency must be an ISO 4217 code such as USD, EUR or BRL."
  }
}

# --- Database ------------------------------------------------------------------------------------

variable "database_provider" {
  description = <<-EOT
    "external": an external Postgres + PostGIS such as Neon (low cost, no fixed fee; its URL is added
    to the fleettrust-database-url secret by hand). "cloudsql": Cloud SQL, created here (fixed monthly cost).
  EOT
  type        = string
  default     = "external"
  validation {
    condition     = contains(["external", "cloudsql"], var.database_provider)
    error_message = "database_provider must be \"external\" or \"cloudsql\"."
  }
}

variable "db_tier" {
  description = "Cloud SQL machine tier (database_provider = \"cloudsql\" only)."
  type        = string
  default     = "db-custom-1-3840"
}

variable "db_high_availability" {
  description = "Regional (HA) Cloud SQL with automatic failover. On in production."
  type        = bool
  default     = false
}

variable "db_disk_size_gb" {
  description = "Initial disk size; it grows automatically."
  type        = number
  default     = 20
}

variable "db_backup_retention_days" {
  description = "Daily backups kept. Point-in-time recovery keeps 7 days of write-ahead logs."
  type        = number
  default     = 14
}

# --- Redis ---------------------------------------------------------------------------------------

variable "redis_provider" {
  description = <<-EOT
    "none": no Redis (rate limits and realtime fan-out per API instance; fine for a small pilot).
    "external": a hosted Redis such as Upstash (its rediss:// URL is added to the fleettrust-redis-url
    secret by hand). "memorystore": Memorystore, created here (fixed monthly cost).
  EOT
  type        = string
  default     = "none"
  validation {
    condition     = contains(["none", "external", "memorystore"], var.redis_provider)
    error_message = "redis_provider must be \"none\", \"external\" or \"memorystore\"."
  }
}

variable "redis_tier" {
  description = "BASIC (staging) or STANDARD_HA (production, with a replica and failover)."
  type        = string
  default     = "BASIC"
}

variable "redis_memory_gb" {
  description = "Memorystore size. Rate limits, cache and pub/sub only: small is enough."
  type        = number
  default     = 1
}

variable "web_origins" {
  description = "Website origins allowed to upload straight to the quarantine bucket with signed URLs (CORS)."
  type        = list(string)
  default     = []
}

# --- Monitoring ----------------------------------------------------------------------------------

variable "api_host" {
  description = "Public host of the API (custom domain or *.run.app) for the uptime check. Empty until the first deploy."
  type        = string
  default     = ""
}

variable "web_host" {
  description = "Public host of the website for the uptime check. Empty until the first deploy."
  type        = string
  default     = ""
}

# --- Release promotion ---------------------------------------------------------------------------

variable "image_readers" {
  description = "Members that may pull images from this project's registry (production's deployer and runtime service agent read from staging, so production runs the exact image tested there)."
  type        = list(string)
  default     = []
}

variable "deletion_protection" {
  description = "Protect the database and keys from deletion. Always on in production."
  type        = bool
  default     = true
}

# --- Malware scanner -------------------------------------------------------------------------------

variable "malware_scanner" {
  description = <<-EOT
    "cloudrun": ClamAV on Cloud Run, scaled to zero (low cost; deployed by the release workflow).
    "vm": clamd on an always-on e2-medium VM with Cloud NAT (fixed monthly cost).
  EOT
  type        = string
  default     = "cloudrun"
  validation {
    condition     = contains(["cloudrun", "vm"], var.malware_scanner)
    error_message = "malware_scanner must be \"cloudrun\" or \"vm\"."
  }
}
