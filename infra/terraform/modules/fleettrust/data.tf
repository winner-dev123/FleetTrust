# Network, PostgreSQL + PostGIS, Redis and the secrets the API reads.
#
# Two setups (docs/operations/environments.md, ADR-0037):
# - low cost (database_provider = "external", redis_provider = "none" or "external"): the database
#   is an external Postgres + PostGIS such as Neon, and Redis is optional (Upstash or none).
#   Terraform creates the empty secrets; their values are added by hand, so they never reach the
#   Terraform state.
# - managed (database_provider = "cloudsql", redis_provider = "memorystore"): Cloud SQL and
#   Memorystore, which have a fixed monthly cost even when idle.

locals {
  cloud_sql   = var.database_provider == "cloudsql"
  memorystore = var.redis_provider == "memorystore"
  redis       = var.redis_provider != "none"
}

# --- Network: Cloud Run reaches Redis and ClamAV over Direct VPC egress (no connector). ----------

resource "google_compute_network" "vpc" {
  project                 = var.project_id
  name                    = local.name
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "run" {
  project                  = var.project_id
  name                     = "${local.name}-run"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = "10.10.0.0/24"
  private_ip_google_access = true
}

# --- Cloud SQL ------------------------------------------------------------------------------------
# Public IP with no authorised networks: only the Cloud SQL connector (IAM-checked) can reach it,
# which is what Cloud Run's cloudsql-instances annotation uses. TLS is required.

resource "google_sql_database_instance" "main" {
  count               = local.cloud_sql ? 1 : 0
  project             = var.project_id
  name                = local.name
  region              = var.region
  database_version    = "POSTGRES_17"
  deletion_protection = var.deletion_protection || local.is_prd

  settings {
    edition                     = "ENTERPRISE"
    tier                        = var.db_tier
    availability_type           = var.db_high_availability ? "REGIONAL" : "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = var.db_disk_size_gb
    disk_autoresize             = true
    deletion_protection_enabled = var.deletion_protection || local.is_prd
    user_labels                 = local.labels

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true # RPO: minutes (target ≤ 15 min)
      start_time                     = "02:00"
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = var.db_backup_retention_days
      }
    }

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    maintenance_window {
      day          = 7 # Sunday
      hour         = 3
      update_track = local.is_prd ? "stable" : "canary"
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = true
      record_client_address   = false
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "1000" # log statements slower than 1 s
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "app" {
  count    = local.cloud_sql ? 1 : 0
  project  = var.project_id
  name     = "fleettrust"
  instance = google_sql_database_instance.main[0].name
}

resource "random_password" "db" {
  count   = local.cloud_sql ? 1 : 0
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  count    = local.cloud_sql ? 1 : 0
  project  = var.project_id
  name     = "fleettrust_app"
  instance = google_sql_database_instance.main[0].name
  password = random_password.db[0].result
}

# --- Redis ----------------------------------------------------------------------------------------

resource "google_redis_instance" "cache" {
  count              = local.memorystore ? 1 : 0
  project            = var.project_id
  name               = local.name
  region             = var.region
  tier               = var.redis_tier
  memory_size_gb     = var.redis_memory_gb
  redis_version      = "REDIS_7_2"
  authorized_network = google_compute_network.vpc.id
  connect_mode       = "DIRECT_PEERING"
  auth_enabled       = true
  labels             = local.labels
  depends_on         = [google_project_service.apis]
}

# --- Secrets (values live in Secret Manager, never in the repository or workflow logs) ------------
# With Cloud SQL or Memorystore, Terraform writes the values, so the state contains them: the state
# bucket is restricted (README). With an external database or Redis, Terraform creates only the
# secret, and the value is added by hand:
#   printf %s "postgresql://…?sslmode=require" | gcloud secrets versions add fleettrust-database-url --data-file=-

resource "google_secret_manager_secret" "database_url" {
  project   = var.project_id
  secret_id = "fleettrust-database-url"
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "database_url" {
  count  = local.cloud_sql ? 1 : 0
  secret = google_secret_manager_secret.database_url.id
  secret_data = format(
    "postgresql://%s:%s@/%s?host=/cloudsql/%s",
    google_sql_user.app[0].name,
    random_password.db[0].result,
    google_sql_database.app[0].name,
    google_sql_database_instance.main[0].connection_name,
  )
}

resource "google_secret_manager_secret" "redis_url" {
  count     = local.redis ? 1 : 0
  project   = var.project_id
  secret_id = "fleettrust-redis-url"
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "redis_url" {
  count  = local.memorystore ? 1 : 0
  secret = google_secret_manager_secret.redis_url[0].id
  secret_data = format(
    "redis://:%s@%s:%d",
    google_redis_instance.cache[0].auth_string,
    google_redis_instance.cache[0].host,
    google_redis_instance.cache[0].port,
  )
}

# Addresses from before these resources became optional (staging was applied on 2026-11-26).
moved {
  from = google_sql_database_instance.main
  to   = google_sql_database_instance.main[0]
}
moved {
  from = google_sql_database.app
  to   = google_sql_database.app[0]
}
moved {
  from = random_password.db
  to   = random_password.db[0]
}
moved {
  from = google_sql_user.app
  to   = google_sql_user.app[0]
}
moved {
  from = google_redis_instance.cache
  to   = google_redis_instance.cache[0]
}
moved {
  from = google_secret_manager_secret_version.database_url
  to   = google_secret_manager_secret_version.database_url[0]
}
moved {
  from = google_secret_manager_secret.redis_url
  to   = google_secret_manager_secret.redis_url[0]
}
moved {
  from = google_secret_manager_secret_version.redis_url
  to   = google_secret_manager_secret_version.redis_url[0]
}
