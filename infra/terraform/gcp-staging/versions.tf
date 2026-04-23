terraform {
  required_version = ">= 1.6.0"

  backend "gcs" {
    bucket = "synapse-terraform-state-fabled-archive-494108-k5"
    prefix = "gcp-staging"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
