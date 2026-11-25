# Identities (least privilege) and keyless deployment from GitHub Actions.
#
#   fleettrust-runtime  the API, the worker and the migration job (Cloud Run)
#   fleettrust-clamav   the malware scanner VM (no Google API access)
#   github-deployer     GitHub Actions only, through Workload Identity Federation (no JSON keys)

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "fleettrust-runtime"
  display_name = "FleetTrust API, worker and migrations"
  depends_on   = [google_project_service.apis]
}

resource "google_service_account" "clamav" {
  project      = var.project_id
  account_id   = "fleettrust-clamav"
  display_name = "FleetTrust malware scanner"
  depends_on   = [google_project_service.apis]
}

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "github-deployer"
  display_name = "GitHub Actions deployer"
  depends_on   = [google_project_service.apis]
}

# --- Runtime -----------------------------------------------------------------------------------------

resource "google_project_iam_member" "runtime" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/cloudtrace.agent",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/errorreporting.writer",
    # Firebase: send pushes (FCM) and delete Auth accounts on erasure (Prompt 27).
    "roles/firebasecloudmessaging.admin",
    "roles/firebaseauth.admin",
  ])
  project = var.project_id
  role    = each.value
  member  = google_service_account.runtime.member
}

resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each = {
    database = google_secret_manager_secret.database_url.id
    redis    = google_secret_manager_secret.redis_url.id
  }
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime.member
}

resource "google_storage_bucket_iam_member" "runtime" {
  for_each = {
    quarantine   = google_storage_bucket.quarantine.name
    sensitive    = google_storage_bucket.sensitive.name
    public_media = google_storage_bucket.public_media.name
  }
  bucket = each.value
  role   = "roles/storage.objectAdmin"
  member = google_service_account.runtime.member
}

resource "google_kms_crypto_key_iam_member" "runtime" {
  crypto_key_id = google_kms_crypto_key.documents.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = google_service_account.runtime.member
}

# Signed upload URLs are signed with the IAM signBlob API as the runtime identity itself.
resource "google_service_account_iam_member" "runtime_signs_urls" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = google_service_account.runtime.member
}

# --- Deployer --------------------------------------------------------------------------------------

resource "google_project_iam_member" "deployer" {
  for_each = toset([
    "roles/run.admin",                # deploy services and jobs, shift traffic, roll back
    "roles/firebaseapphosting.admin", # web rollouts
    "roles/logging.viewer",           # read the canary revision's request logs
  ])
  project = var.project_id
  role    = each.value
  member  = google_service_account.deployer.member
}

resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.images.repository_id
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deployer.member
}

# The deployer may start services as the runtime identity, and nothing else.
resource "google_service_account_iam_member" "deployer_acts_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deployer.member
}

# --- Workload Identity Federation ------------------------------------------------------------------
# Staging: only workflows on main can deploy. Production: only jobs that run in the protected
# "production" GitHub environment (required reviewers approve each release).

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "fleettrust-repo"
  display_name                       = "FleetTrust repository"

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.repository"  = "assertion.repository"
    "attribute.ref"         = "assertion.ref"
    "attribute.environment" = "assertion.environment"
  }

  attribute_condition = local.is_prd ? (
    "assertion.repository == '${var.github_repository}' && assertion.environment == 'production'"
    ) : (
    "assertion.repository == '${var.github_repository}' && assertion.ref == 'refs/heads/main'"
  )

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}
