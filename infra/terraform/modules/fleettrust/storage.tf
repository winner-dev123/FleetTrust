# Object storage (ADR-0006), the document encryption key (ADR-0016) and the container registry.

# Uploads land here first (signed URL, one use); scanned, then moved or deleted. Anything left
# behind (an abandoned upload) is deleted after a day: this closes the Prompt 27 gap.
resource "google_storage_bucket" "quarantine" {
  project                     = var.project_id
  name                        = "${var.project_id}-quarantine"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = !local.is_prd
  labels                      = local.labels

  soft_delete_policy {
    retention_duration_seconds = 0 # nothing here is worth keeping
  }

  lifecycle_rule {
    condition {
      age = 1
    }
    action {
      type = "Delete"
    }
  }

  dynamic "cors" {
    for_each = length(var.web_origins) > 0 ? [1] : []
    content {
      origin          = var.web_origins
      method          = ["PUT"]
      response_header = ["Content-Type"]
      max_age_seconds = 3600
    }
  }

  depends_on = [google_project_service.apis]
}

# Encrypted documents and private attachments (per-file envelope encryption with the KMS key).
resource "google_storage_bucket" "sensitive" {
  project                     = var.project_id
  name                        = "${var.project_id}-sensitive"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = true
  }

  soft_delete_policy {
    retention_duration_seconds = 604800 # 7 days to recover a mistaken delete
  }

  # Old versions (after an overwrite or delete) go after 30 days; retention rules in the app
  # decide when current objects are deleted (docs/security/data-retention.md).
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.apis]
}

# Public media (published photos and logos, metadata stripped). Readable by anyone.
resource "google_storage_bucket" "public_media" {
  project                     = var.project_id
  name                        = "${var.project_id}-public-media"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "inherited"
  force_destroy               = !local.is_prd
  labels                      = local.labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "public_media_read" {
  bucket = google_storage_bucket.public_media.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# --- KMS: wraps the per-file data keys. Rotated every 90 days; old versions still decrypt. -------

resource "google_kms_key_ring" "main" {
  project    = var.project_id
  name       = local.name
  location   = var.region
  depends_on = [google_project_service.apis]
}

resource "google_kms_crypto_key" "documents" {
  name            = "documents"
  key_ring        = google_kms_key_ring.main.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s" # 90 days
  labels          = local.labels

  lifecycle {
    prevent_destroy = true # destroying it makes every stored document unreadable
  }
}

# --- Container registry ------------------------------------------------------------------------------

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = "fleettrust"
  format        = "DOCKER"
  labels        = local.labels

  # Keep the last 20 versions of each image (enough to roll back) and anything newer than 30 days.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "2592000s" # 30 days
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_artifact_registry_repository_iam_member" "image_readers" {
  for_each   = toset(var.image_readers)
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.images.repository_id
  role       = "roles/artifactregistry.reader"
  member     = each.value
}
