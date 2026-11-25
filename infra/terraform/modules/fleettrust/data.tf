# Network, PostgreSQL + PostGIS (Cloud SQL), Redis (Memorystore) and the secrets the API reads.

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
  project  = var.project_id
  name     = "fleettrust"
  instance = google_sql_database_instance.main.name
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  project  = var.project_id
  name     = "fleettrust_app"
  instance = google_sql_database_instance.main.name
  password = random_password.db.result
}

# --- Redis ----------------------------------------------------------------------------------------

resource "google_redis_instance" "cache" {
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
# Terraform state contains these values: the state bucket is restricted (README).

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
  secret = google_secret_manager_secret.database_url.id
  secret_data = format(
    "postgresql://%s:%s@/%s?host=/cloudsql/%s",
    google_sql_user.app.name,
    random_password.db.result,
    google_sql_database.app.name,
    google_sql_database_instance.main.connection_name,
  )
}

resource "google_secret_manager_secret" "redis_url" {
  project   = var.project_id
  secret_id = "fleettrust-redis-url"
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "redis_url" {
  secret = google_secret_manager_secret.redis_url.id
  secret_data = format(
    "redis://:%s@%s:%d",
    google_redis_instance.cache.auth_string,
    google_redis_instance.cache.host,
    google_redis_instance.cache.port,
  )
}
