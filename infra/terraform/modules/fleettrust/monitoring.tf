# Alerts (docs/operations/observability.md, docs/operations/slo.md) and the budget alert (OQ-07).
# Every alert emails var.alert_email; the emergency path alerts are the ones to page on.

resource "google_monitoring_notification_channel" "email" {
  project      = var.project_id
  display_name = "FleetTrust ${var.environment} alerts"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
  depends_on = [google_project_service.apis]
}

locals {
  channels = [google_monitoring_notification_channel.email.id]
  # Cloud Run request metrics for the API service, in PromQL.
  api = "monitored_resource=\"cloud_run_revision\",service_name=\"fleettrust-api\""
}

# --- Log-based metrics (messages written by the API, see the code references) -------------------

# AllExceptionsFilter: transient database pressure answered with 503 overloaded (Prompt 28).
resource "google_logging_metric" "overloaded" {
  project = var.project_id
  name    = "fleettrust_overloaded"
  filter  = "resource.type=\"cloud_run_revision\" AND jsonPayload.message:\"overloaded:\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# EmergencyDispatcher: a delivery that failed after every retry, or a dispatcher tick that failed.
resource "google_logging_metric" "emergency_failures" {
  project = var.project_id
  name    = "fleettrust_emergency_failures"
  filter  = "resource.type=\"cloud_run_revision\" AND severity>=ERROR AND (jsonPayload.message:\"emergency delivery\" OR jsonPayload.message:\"emergency tick failed\")"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# --- Alert policies ---------------------------------------------------------------------------------

resource "google_monitoring_alert_policy" "api_5xx" {
  project               = var.project_id
  display_name          = "API 5xx above 2 % for 5 minutes"
  combiner              = "OR"
  notification_channels = local.channels
  conditions {
    display_name = "5xx ratio"
    condition_prometheus_query_language {
      query               = "sum(rate(run_googleapis_com:request_count{${local.api},response_code_class=\"5xx\"}[5m])) / sum(rate(run_googleapis_com:request_count{${local.api}}[5m])) > 0.02"
      duration            = "300s"
      evaluation_interval = "60s"
    }
  }
  documentation {
    content   = "Check Error Reporting and recent releases; roll back with the Rollback workflow if a release caused it (docs/operations/release-and-rollback.md)."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "api_latency" {
  project               = var.project_id
  display_name          = "API p95 latency above 1 s for 10 minutes"
  combiner              = "OR"
  notification_channels = local.channels
  conditions {
    display_name = "p95 latency"
    condition_prometheus_query_language {
      query               = "histogram_quantile(0.95, sum by (le) (rate(run_googleapis_com:request_latencies_bucket{${local.api}}[5m]))) > 1000"
      duration            = "600s"
      evaluation_interval = "60s"
    }
  }
  documentation {
    content   = "SLOs: search p95 400 ms, writes 500 ms (docs/operations/slo.md). Check Cloud SQL CPU and the overloaded alert first."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "overloaded" {
  project               = var.project_id
  display_name          = "API shedding load (503 overloaded)"
  combiner              = "OR"
  notification_channels = local.channels
  conditions {
    display_name = "overloaded responses"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.overloaded.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      duration        = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  documentation {
    content   = "The database pool or Cloud SQL is saturated. Levers: Cloud Run concurrency vs DB_POOL_MAX, Cloud SQL tier (docs/operations/slo.md#capacity-notes-and-levers)."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "emergency" {
  project               = var.project_id
  display_name          = "EMERGENCY: alert delivery failed"
  combiner              = "OR"
  notification_channels = local.channels
  severity              = "CRITICAL"
  conditions {
    display_name = "emergency delivery failures"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.emergency_failures.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  documentation {
    content   = "Someone's emergency alert may not have reached a contact. Follow the emergency playbook in docs/operations/incident-response.md now."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "database" {
  project               = var.project_id
  display_name          = "Cloud SQL CPU or disk above 80 %"
  combiner              = "OR"
  notification_channels = local.channels
  conditions {
    display_name = "CPU"
    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "600s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  conditions {
    display_name = "Disk"
    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/disk/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "600s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
}

# --- Uptime checks (created once the hosts are known) ----------------------------------------------

resource "google_monitoring_uptime_check_config" "api" {
  count        = var.api_host == "" ? 0 : 1
  project      = var.project_id
  display_name = "API ready (${var.environment})"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path           = "/health/ready"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.api_host
    }
  }

  content_matchers {
    content = "\"ready\""
    matcher = "CONTAINS_STRING"
  }
}

resource "google_monitoring_uptime_check_config" "web" {
  count        = var.web_host == "" ? 0 : 1
  project      = var.project_id
  display_name = "Website (${var.environment})"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path           = "/"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.web_host
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  count                 = var.api_host == "" ? 0 : 1
  project               = var.project_id
  display_name          = "API not ready from two or more regions"
  combiner              = "OR"
  notification_channels = local.channels
  conditions {
    display_name = "uptime check failing"
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.api[0].uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.project_id"]
      }
    }
  }
}

# --- Budget ---------------------------------------------------------------------------------------

resource "google_billing_budget" "monthly" {
  count           = var.billing_account == "" ? 0 : 1
  billing_account = var.billing_account
  display_name    = "FleetTrust ${var.environment} monthly"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  all_updates_rule {
    monitoring_notification_channels = local.channels
    disable_default_iam_recipients   = false
  }
}
