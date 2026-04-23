terraform {
  backend "gcs" {
    bucket = "cs-tfstate-us-central1-a66260155a214d6e8808c0172609b3c7"
    prefix = "terraform"
  }
}
