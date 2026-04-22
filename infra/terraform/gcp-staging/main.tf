locals {
  name_prefix = "synapse-${var.environment}"
  labels = merge(
    {
      app         = "synapse-network"
      environment = var.environment
      managed_by  = "terraform"
    },
    var.labels,
  )
  iap_ssh_ranges = var.enable_iap_ssh ? ["35.235.240.0/20"] : []
  ssh_ranges     = distinct(concat(var.ssh_source_ranges, local.iap_ssh_ranges))
}

resource "google_compute_network" "staging" {
  name                    = "${local.name_prefix}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "staging" {
  name          = "${local.name_prefix}-subnet"
  ip_cidr_range = "10.42.0.0/24"
  network       = google_compute_network.staging.id
  region        = var.region
}

resource "google_compute_address" "staging" {
  name   = "${local.name_prefix}-ip"
  region = var.region
}

resource "google_service_account" "staging_vm" {
  account_id   = "${local.name_prefix}-vm"
  display_name = "Synapse ${var.environment} VM"
}

resource "google_project_iam_member" "logging_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.staging_vm.email}"
}

resource "google_project_iam_member" "monitoring_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.staging_vm.email}"
}

resource "google_project_iam_member" "secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.staging_vm.email}"
}

resource "google_compute_firewall" "http_https" {
  name    = "${local.name_prefix}-allow-http-https"
  network = google_compute_network.staging.name

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["${local.name_prefix}-web"]
}

resource "google_compute_firewall" "ssh" {
  count   = length(local.ssh_ranges) > 0 ? 1 : 0
  name    = "${local.name_prefix}-allow-ssh"
  network = google_compute_network.staging.name

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = local.ssh_ranges
  target_tags   = ["${local.name_prefix}-ssh"]
}

resource "google_artifact_registry_repository" "docker" {
  location      = var.region
  repository_id = var.artifact_registry_repository
  description   = "Synapse staging Docker images"
  format        = "DOCKER"
  labels        = local.labels
}

resource "google_storage_bucket" "backups" {
  name                        = var.backup_bucket_name
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_secret_manager_secret" "placeholders" {
  for_each  = var.secret_ids
  secret_id = each.value
  labels    = local.labels

  replication {
    auto {}
  }
}

resource "google_compute_instance" "staging" {
  name         = "${local.name_prefix}-vm"
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["${local.name_prefix}-web", "${local.name_prefix}-ssh"]
  labels       = local.labels

  boot_disk {
    initialize_params {
      image = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64"
      size  = var.boot_disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.staging.id
    access_config {
      nat_ip = google_compute_address.staging.address
    }
  }

  service_account {
    email  = google_service_account.staging_vm.email
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = file("${path.module}/startup.sh")

  depends_on = [
    google_project_iam_member.logging_writer,
    google_project_iam_member.monitoring_writer,
    google_project_iam_member.secret_accessor,
  ]
}
