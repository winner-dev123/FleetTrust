# Malware scanner (ADR-0006, ADR-0037). Two setups:
# - malware_scanner = "cloudrun" (default, low cost): ClamAV behind a small HTTP server
#   (apps/scanner) on Cloud Run, scaled to zero. The release workflow deploys it
#   (deploy/cloudrun/scanner.sh); nothing below is created.
# - malware_scanner = "vm": clamd on a small internal VM (fixed monthly cost, plus Cloud NAT for
#   signature updates). The VM has no public IP and only the Cloud Run subnet can reach port 3310.
# Either way the API fails closed when the scanner is unreachable (uploads stay in quarantine).

locals {
  clamav_vm    = var.malware_scanner == "vm"
  clamav_image = "clamav/clamav:1.5.5-debian@sha256:85f35b3eee903dbd96c5ca250c5aa13d230d97987c0f876f7d46f001f9414239"
}

resource "google_compute_address" "clamav" {
  count        = local.clamav_vm ? 1 : 0
  project      = var.project_id
  name         = "${local.name}-clamav"
  region       = var.region
  subnetwork   = google_compute_subnetwork.run.id
  address_type = "INTERNAL"
}

resource "google_compute_instance" "clamav" {
  count        = local.clamav_vm ? 1 : 0
  project      = var.project_id
  name         = "${local.name}-clamav"
  zone         = "${var.region}-b"
  machine_type = "e2-medium" # 4 GB: the signature database needs about 3 GB
  labels       = local.labels
  tags         = ["clamav"]

  boot_disk {
    initialize_params {
      image = "cos-cloud/cos-stable"
      size  = 20
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.run.id
    network_ip = google_compute_address.clamav[0].address
    # No access_config block: no public IP.
  }

  service_account {
    email  = google_service_account.clamav.email
    scopes = ["logging-write", "monitoring-write"]
  }

  shielded_instance_config {
    enable_secure_boot = true
  }

  metadata = {
    enable-oslogin = "TRUE"
    # Container-Optimized OS runs this with cloud-init; freshclam inside the image keeps
    # signatures current. Cloud NAT gives it outbound access for signature updates.
    user-data = <<-EOT
      #cloud-config
      write_files:
        - path: /etc/systemd/system/clamav.service
          permissions: "0644"
          content: |
            [Unit]
            Description=ClamAV daemon
            After=docker.service
            Requires=docker.service
            [Service]
            Restart=always
            ExecStartPre=-/usr/bin/docker rm -f clamav
            ExecStart=/usr/bin/docker run --rm --name clamav -p 3310:3310 ${local.clamav_image}
            ExecStop=/usr/bin/docker stop clamav
            [Install]
            WantedBy=multi-user.target
      runcmd:
        - systemctl daemon-reload
        - systemctl enable --now clamav.service
    EOT
  }

  allow_stopping_for_update = true
  depends_on                = [google_project_service.apis]
}

resource "google_compute_firewall" "clamav_from_run" {
  count         = local.clamav_vm ? 1 : 0
  project       = var.project_id
  name          = "${local.name}-clamav-from-run"
  network       = google_compute_network.vpc.id
  direction     = "INGRESS"
  source_ranges = [google_compute_subnetwork.run.ip_cidr_range]
  target_tags   = ["clamav"]

  allow {
    protocol = "tcp"
    ports    = ["3310"]
  }
}

# Outbound internet for signature updates (the VM has no public IP).
resource "google_compute_router" "nat" {
  count   = local.clamav_vm ? 1 : 0
  project = var.project_id
  name    = "${local.name}-nat"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_router_nat" "nat" {
  count                              = local.clamav_vm ? 1 : 0
  project                            = var.project_id
  name                               = "${local.name}-nat"
  router                             = google_compute_router.nat[0].name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# Addresses from before these resources became optional (staging was applied on 2026-11-26).
moved {
  from = google_compute_address.clamav
  to   = google_compute_address.clamav[0]
}
moved {
  from = google_compute_instance.clamav
  to   = google_compute_instance.clamav[0]
}
moved {
  from = google_compute_firewall.clamav_from_run
  to   = google_compute_firewall.clamav_from_run[0]
}
moved {
  from = google_compute_router.nat
  to   = google_compute_router.nat[0]
}
moved {
  from = google_compute_router_nat.nat
  to   = google_compute_router_nat.nat[0]
}
