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
