# Optional edge for the API (risk R-05): a global external HTTPS load balancer with a Google-managed
# certificate, modern TLS, HTTP→HTTPS redirect and a Cloud Armor policy (per-IP rate ban, adaptive
# DDoS protection, OWASP SQLi/XSS rules). Created when api_domain is set; point the domain's A
# record at the api_ip_address output. The website gets its domain and certificate from App Hosting.
#
# The WAF rules start in preview (logged, not enforced): FleetTrust carries free text (messages,
# articles), so false positives are tuned from the logs before switching preview off.
# The Cloud Run URL stays reachable so release candidates can be smoke tested on their own URL;
# the API's own rate limits and App Check (enforced in production) apply there too.

variable "api_domain" {
  description = "Custom domain for the API (e.g. api.example.com). Empty: no load balancer, the *.run.app URL is used."
  type        = string
  default     = ""
}

locals {
  edge = var.api_domain != ""
}

resource "google_compute_security_policy" "api" {
  count       = local.edge ? 1 : 0
  project     = var.project_id
  name        = "${local.name}-api"
  description = "FleetTrust API edge policy"
  type        = "CLOUD_ARMOR"

  rule {
    action      = "deny(403)"
    priority    = 1000
    preview     = true
    description = "OWASP SQL injection (preview until tuned)"
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sqli-v33-stable', {'sensitivity': 1})"
      }
    }
  }

  rule {
    action      = "deny(403)"
    priority    = 1001
    preview     = true
    description = "OWASP cross-site scripting (preview until tuned)"
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('xss-v33-stable', {'sensitivity': 1})"
      }
    }
  }

  # Far above any real client (the API's own limits are much lower); stops floods at the edge.
  rule {
    action      = "rate_based_ban"
    priority    = 2000
    description = "Ban an IP for 5 minutes above 1,200 requests a minute"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action   = "allow"
      exceed_action    = "deny(429)"
      enforce_on_key   = "IP"
      ban_duration_sec = 300
      rate_limit_threshold {
        count        = 1200
        interval_sec = 60
      }
    }
  }

  rule {
    action      = "allow"
    priority    = 2147483647
    description = "Default: allow"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }

  adaptive_protection_config {
    layer_7_ddos_defense_config {
      enable = true
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_compute_region_network_endpoint_group" "api" {
  count                 = local.edge ? 1 : 0
  project               = var.project_id
  name                  = "${local.name}-api"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = "fleettrust-api"
  }
}

resource "google_compute_backend_service" "api" {
  count                 = local.edge ? 1 : 0
  project               = var.project_id
  name                  = "${local.name}-api"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.api[0].id

  backend {
    group = google_compute_region_network_endpoint_group.api[0].id
  }

  log_config {
    enable      = true
    sample_rate = 1
  }
}

resource "google_compute_url_map" "api" {
  count           = local.edge ? 1 : 0
  project         = var.project_id
  name            = "${local.name}-api"
  default_service = google_compute_backend_service.api[0].id
}

resource "google_compute_managed_ssl_certificate" "api" {
  count   = local.edge ? 1 : 0
  project = var.project_id
  name    = "${local.name}-api"
  managed {
    domains = [var.api_domain]
  }
}

resource "google_compute_ssl_policy" "modern" {
  count           = local.edge ? 1 : 0
  project         = var.project_id
  name            = "${local.name}-modern"
  profile         = "MODERN"
  min_tls_version = "TLS_1_2"
}

resource "google_compute_target_https_proxy" "api" {
  count            = local.edge ? 1 : 0
  project          = var.project_id
  name             = "${local.name}-api"
  url_map          = google_compute_url_map.api[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.api[0].id]
  ssl_policy       = google_compute_ssl_policy.modern[0].id
}

resource "google_compute_global_address" "api" {
  count   = local.edge ? 1 : 0
  project = var.project_id
  name    = "${local.name}-api"
}

resource "google_compute_global_forwarding_rule" "api_https" {
  count                 = local.edge ? 1 : 0
  project               = var.project_id
  name                  = "${local.name}-api-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.api[0].id
  port_range            = "443"
  target                = google_compute_target_https_proxy.api[0].id
}

# Plain HTTP only redirects to HTTPS.
resource "google_compute_url_map" "api_redirect" {
  count   = local.edge ? 1 : 0
  project = var.project_id
  name    = "${local.name}-api-redirect"
  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "api_redirect" {
  count   = local.edge ? 1 : 0
  project = var.project_id
  name    = "${local.name}-api-redirect"
  url_map = google_compute_url_map.api_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "api_http" {
  count                 = local.edge ? 1 : 0
  project               = var.project_id
  name                  = "${local.name}-api-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.api[0].id
  port_range            = "80"
  target                = google_compute_target_http_proxy.api_redirect[0].id
}

output "api_ip_address" {
  description = "Point the API domain's A record here (empty without api_domain)."
  value       = local.edge ? google_compute_global_address.api[0].address : ""
}
