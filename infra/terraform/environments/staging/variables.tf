variable "project_id" {
  description = "Google Cloud project for this environment."
  type        = string
}

variable "region" {
  description = "Region for all regional resources (OQ-02: Europe)."
  type        = string
  default     = "europe-west1"
}

variable "github_repository" {
  description = "owner/name of the repository allowed to deploy."
  type        = string
  default     = "winner-dev123/FleetTrust"
}

variable "alert_email" {
  description = "Where alerts and budget warnings go."
  type        = string
}

variable "billing_account" {
  description = "Billing account ID for the budget alert (empty skips it)."
  type        = string
  default     = ""
}

variable "monthly_budget" {
  description = "Monthly budget alert amount, in budget_currency."
  type        = number
  default     = 200
}

variable "budget_currency" {
  description = "The billing account's currency (e.g. USD, EUR, BRL); Google rejects any other."
  type        = string
  default     = "USD"
}

variable "web_origins" {
  description = "Website origins allowed to upload with signed URLs."
  type        = list(string)
  default     = []
}

variable "api_host" {
  description = "Public API host for the uptime check (empty until the first deploy)."
  type        = string
  default     = ""
}

variable "web_host" {
  description = "Public website host for the uptime check (empty until the first deploy)."
  type        = string
  default     = ""
}

variable "image_readers" {
  description = "Members allowed to pull images from staging (production's deployer and Cloud Run service agent)."
  type        = list(string)
  default     = []
}

variable "api_domain" {
  description = "Custom API domain behind the load balancer and Cloud Armor (empty: none yet)."
  type        = string
  default     = ""
}

variable "database_provider" {
  description = "\"external\" (Neon or another Postgres + PostGIS; low cost) or \"cloudsql\" (fixed monthly cost)."
  type        = string
  default     = "external"
}

variable "redis_provider" {
  description = "\"none\", \"external\" (Upstash or another hosted Redis) or \"memorystore\" (fixed monthly cost)."
  type        = string
  default     = "none"
}

variable "malware_scanner" {
  description = "\"cloudrun\" (ClamAV on Cloud Run, scaled to zero; low cost) or \"vm\" (always-on VM; fixed monthly cost)."
  type        = string
  default     = "cloudrun"
}
