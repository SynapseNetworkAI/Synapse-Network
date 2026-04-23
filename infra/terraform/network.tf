# VPC and Subnets
module "cs-vpc-prod-shared" {
  source  = "terraform-google-modules/network/google"
  version = "~> 9.0"

  project_id   = module.cs-project-vpc-host-prod.project_id
  network_name = "vpc-prod-shared"

  subnets = [
    {
      subnet_name               = "subnet-prod-1"
      subnet_ip                 = "10.0.1.0/24"
      subnet_region             = "us-central1"
      subnet_private_access     = true
      subnet_flow_logs          = true
      subnet_flow_logs_sampling = "0.5"
      subnet_flow_logs_metadata = "INCLUDE_ALL_METADATA"
      subnet_flow_logs_interval = "INTERVAL_10_MIN"
    },
    {
      subnet_name               = "subnet-prod-2"
      subnet_ip                 = "10.0.2.0/24"
      subnet_region             = "us-west1"
      subnet_private_access     = true
      subnet_flow_logs          = true
      subnet_flow_logs_sampling = "0.5"
      subnet_flow_logs_metadata = "INCLUDE_ALL_METADATA"
      subnet_flow_logs_interval = "INTERVAL_10_MIN"
    },
  ]

  firewall_rules = [
    {
      name      = "vpc-prod-shared-allow-icmp"
      direction = "INGRESS"
      priority  = 10000
      log_config = {
        metadata = "INCLUDE_ALL_METADATA"
      }
      allow = [
        {
          protocol = "icmp"
          ports    = []
        }
      ]
      ranges = [
        "10.128.0.0/9",
      ]
    },
    {
      name      = "vpc-prod-shared-allow-ssh"
      direction = "INGRESS"
      priority  = 10000
      log_config = {
        metadata = "INCLUDE_ALL_METADATA"
      }
      allow = [
        {
          protocol = "tcp"
          ports    = ["22"]
        }
      ]
      ranges = [
        "35.235.240.0/20",
      ]
    },
    {
      name      = "vpc-prod-shared-allow-rdp"
      direction = "INGRESS"
      priority  = 10000
      log_config = {
        metadata = "INCLUDE_ALL_METADATA"
      }
      allow = [
        {
          protocol = "tcp"
          ports    = ["3389"]
        }
      ]
      ranges = [
        "35.235.240.0/20",
      ]
    },
  ]
}

# VPC and Subnets
module "cs-vpc-staging-shared" {
  source  = "terraform-google-modules/network/google"
  version = "~> 9.0"

  project_id   = module.cs-project-vpc-host-nonprod.project_id
  network_name = "vpc-staging-shared"

  subnets = [
    {
      subnet_name               = "subnet-staging-prod-1"
      subnet_ip                 = "10.1.1.0/24"
      subnet_region             = "us-central1"
      subnet_private_access     = true
      subnet_flow_logs          = true
      subnet_flow_logs_sampling = "0.5"
      subnet_flow_logs_metadata = "INCLUDE_ALL_METADATA"
      subnet_flow_logs_interval = "INTERVAL_10_MIN"
    },
    {
      subnet_name               = "subnet-staging-prod-2"
      subnet_ip                 = "10.1.2.0/24"
      subnet_region             = "us-west1"
      subnet_private_access     = true
      subnet_flow_logs          = true
      subnet_flow_logs_sampling = "0.5"
      subnet_flow_logs_metadata = "INCLUDE_ALL_METADATA"
      subnet_flow_logs_interval = "INTERVAL_10_MIN"
    },
  ]

  firewall_rules = [
    {
      name      = "vpc-staging-shared-allow-icmp"
      direction = "INGRESS"
      priority  = 10000
      log_config = {
        metadata = "INCLUDE_ALL_METADATA"
      }
      allow = [
        {
          protocol = "icmp"
          ports    = []
        }
      ]
      ranges = [
        "10.128.0.0/9",
      ]
    },
    {
      name      = "vpc-staging-shared-allow-ssh"
      direction = "INGRESS"
      priority  = 10000
      log_config = {
        metadata = "INCLUDE_ALL_METADATA"
      }
      allow = [
        {
          protocol = "tcp"
          ports    = ["22"]
        }
      ]
      ranges = [
        "35.235.240.0/20",
      ]
    },
    {
      name      = "vpc-staging-shared-allow-rdp"
      direction = "INGRESS"
      priority  = 10000
      log_config = {
        metadata = "INCLUDE_ALL_METADATA"
      }
      allow = [
        {
          protocol = "tcp"
          ports    = ["3389"]
        }
      ]
      ranges = [
        "35.235.240.0/20",
      ]
    },
  ]
}

resource "google_compute_address" "cs-ca-vpc-host-prod-ik349-ax154-subnet-prod-1" {
  project = module.cs-project-vpc-host-prod.project_id
  name    = "ca-vpc-host-prod-ik349-ax154-subnet-prod-1"
  region  = "us-central1"
}

module "cs-cr-vpc-host-prod-ik349-ax154-subnet-prod-1" {
  source  = "terraform-google-modules/cloud-router/google"
  version = "~> 6.0"

  name    = "cr-vpc-host-prod-ik349-ax154-subnet-prod-1"
  project = module.cs-project-vpc-host-prod.project_id
  region  = "us-central1"
  network = module.cs-vpc-prod-shared.network_self_link
  nats = [
    {
      name    = "subnet-prod-1"
      nat_ips = google_compute_address.cs-ca-vpc-host-prod-ik349-ax154-subnet-prod-1.*.self_link
      log_config = {
        filter = "TRANSLATIONS_ONLY"
      }
    },
  ]
}

resource "google_compute_address" "cs-ca-vpc-host-prod-ik349-ax154-subnet-prod-2" {
  project = module.cs-project-vpc-host-prod.project_id
  name    = "ca-vpc-host-prod-ik349-ax154-subnet-prod-2"
  region  = "us-west1"
}

module "cs-cr-vpc-host-prod-ik349-ax154-subnet-prod-2" {
  source  = "terraform-google-modules/cloud-router/google"
  version = "~> 6.0"

  name    = "cr-vpc-host-prod-ik349-ax154-subnet-prod-2"
  project = module.cs-project-vpc-host-prod.project_id
  region  = "us-west1"
  network = module.cs-vpc-prod-shared.network_self_link
  nats = [
    {
      name    = "subnet-prod-2"
      nat_ips = google_compute_address.cs-ca-vpc-host-prod-ik349-ax154-subnet-prod-2.*.self_link
      log_config = {
        filter = "TRANSLATIONS_ONLY"
      }
    },
  ]
}

resource "google_compute_address" "cs-ca-vpc-host-nonprod-di982-ca921-subnet-staging-prod-1" {
  project = module.cs-project-vpc-host-nonprod.project_id
  name    = "ca-vpc-host-nonprod-di982-ca921-subnet-staging-prod-1"
  region  = "us-central1"
}

module "cs-cr-vpc-host-nonprod-di982-ca921-subnet-staging-prod-1" {
  source  = "terraform-google-modules/cloud-router/google"
  version = "~> 6.0"

  name    = "cr-vpc-host-nonprod-di982-ca921-subnet-staging-prod-1"
  project = module.cs-project-vpc-host-nonprod.project_id
  region  = "us-central1"
  network = module.cs-vpc-staging-shared.network_self_link
  nats = [
    {
      name    = "subnet-staging-prod-1"
      nat_ips = google_compute_address.cs-ca-vpc-host-nonprod-di982-ca921-subnet-staging-prod-1.*.self_link
      log_config = {
        filter = "TRANSLATIONS_ONLY"
      }
    },
  ]
}

resource "google_compute_address" "cs-ca-vpc-host-nonprod-di982-ca921-subnet-staging-prod-2" {
  project = module.cs-project-vpc-host-nonprod.project_id
  name    = "ca-vpc-host-nonprod-di982-ca921-subnet-staging-prod-2"
  region  = "us-west1"
}

module "cs-cr-vpc-host-nonprod-di982-ca921-subnet-staging-prod-2" {
  source  = "terraform-google-modules/cloud-router/google"
  version = "~> 6.0"

  name    = "cr-vpc-host-nonprod-di982-ca921-subnet-staging-prod-2"
  project = module.cs-project-vpc-host-nonprod.project_id
  region  = "us-west1"
  network = module.cs-vpc-staging-shared.network_self_link
  nats = [
    {
      name    = "subnet-staging-prod-2"
      nat_ips = google_compute_address.cs-ca-vpc-host-nonprod-di982-ca921-subnet-staging-prod-2.*.self_link
      log_config = {
        filter = "TRANSLATIONS_ONLY"
      }
    },
  ]
}
