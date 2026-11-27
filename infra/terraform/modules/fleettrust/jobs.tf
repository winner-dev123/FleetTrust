# On-demand worker (ADR-0037 step 3). The worker service scales to zero; it is woken by:
# - Cloud Tasks (queue fleettrust-jobs): the API after writes, and the worker itself while an
#   emergency is active or a retry is due (WorkerRunner);
# - Cloud Scheduler: a safety-net run every 15 minutes, vehicle reminders hourly and retention daily.
# Both call the worker with an identity token for fleettrust-jobs, the only account allowed to
# invoke it besides operators. Cloud Tasks is free up to a million operations a month, and Cloud
# Scheduler for 3 jobs per billing account (USD 0.10 a month per extra job).

locals {
  # Cloud Run's deterministic URL (https://<service>-<project number>.<region>.run.app), known
  # before the first release deploys the worker.
  worker_url = "https://fleettrust-worker-${data.google_project.this.number}.${var.region}.run.app"
}

resource "google_cloud_tasks_queue" "jobs" {
  project  = var.project_id
  name     = "fleettrust-jobs"
  location = var.region

  rate_limits {
    max_dispatches_per_second = 5
    max_concurrent_dispatches = 5
  }

  retry_config {
    max_attempts  = 5
    min_backoff   = "2s"
    max_backoff   = "60s"
    max_doublings = 4
  }

  depends_on = [google_project_service.apis]
}

resource "google_service_account" "jobs" {
  project      = var.project_id
  account_id   = "fleettrust-jobs"
  display_name = "FleetTrust worker wake-ups (Cloud Tasks and Cloud Scheduler)"
}

# May invoke Cloud Run services in this project (the worker is internal-only besides).
resource "google_project_iam_member" "jobs_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = google_service_account.jobs.member
}

# The API and the worker create wake-ups that carry fleettrust-jobs' identity token.
resource "google_cloud_tasks_queue_iam_member" "runtime_enqueuer" {
  project  = var.project_id
  location = google_cloud_tasks_queue.jobs.location
  name     = google_cloud_tasks_queue.jobs.name
  role     = "roles/cloudtasks.enqueuer"
  member   = google_service_account.runtime.member
}

resource "google_service_account_iam_member" "runtime_acts_as_jobs" {
  service_account_id = google_service_account.jobs.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.runtime.member
}

resource "google_cloud_scheduler_job" "worker" {
  for_each = {
    # Catches a lost wake-up. Not more often, so the database (Neon) can suspend when idle.
    run       = { schedule = "*/15 * * * *", path = "/internal/jobs/run" }
    reminders = { schedule = "5 * * * *", path = "/internal/jobs/reminders" }
    retention = { schedule = "30 3 * * *", path = "/internal/jobs/retention" }
  }

  project          = var.project_id
  region           = var.region
  name             = "fleettrust-${each.key}"
  schedule         = each.value.schedule
  time_zone        = "Etc/UTC"
  attempt_deadline = "320s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "${local.worker_url}${each.value.path}"
    oidc_token {
      service_account_email = google_service_account.jobs.email
      audience              = local.worker_url
    }
  }

  depends_on = [google_project_service.apis]
}
