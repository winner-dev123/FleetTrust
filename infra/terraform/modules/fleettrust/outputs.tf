# Values the release workflows need: set them as GitHub repository (staging) or environment
# (production) variables. `terraform output` prints them; none are secret.

output "project_id" {
  value = var.project_id
}

output "region" {
  value = var.region
}

output "registry" {
  description = "Docker registry for the API image."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "deploy_service_account" {
  value = google_service_account.deployer.email
}

output "runtime_service_account" {
  value = google_service_account.runtime.email
}

# Empty with an external database: the deploy workflows then skip the Cloud SQL link.
output "cloudsql_connection_name" {
  value = local.cloud_sql ? google_sql_database_instance.main[0].connection_name : ""
}

# Secret holding REDIS_URL, or empty when Redis isn't used (GitHub variable REDIS_SECRET).
output "redis_secret" {
  value = local.redis ? google_secret_manager_secret.redis_url[0].secret_id : ""
}

output "vpc_network" {
  value = google_compute_network.vpc.name
}

output "vpc_subnet" {
  value = google_compute_subnetwork.run.name
}

output "quarantine_bucket" {
  value = google_storage_bucket.quarantine.name
}

output "sensitive_bucket" {
  value = google_storage_bucket.sensitive.name
}

output "public_media_bucket" {
  value = google_storage_bucket.public_media.name
}

output "document_kms_key" {
  value = google_kms_crypto_key.documents.id
}

# The ClamAV VM's address, or empty with the scanner service (GitHub variable CLAMAV_HOST).
output "clamav_host" {
  value = local.clamav_vm ? google_compute_address.clamav[0].address : ""
}

# Identity of the scanner service (GitHub variable GCP_SCANNER_SERVICE_ACCOUNT).
output "scanner_service_account" {
  value = google_service_account.clamav.email
}
