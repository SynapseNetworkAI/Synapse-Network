# In order to create google groups, the calling identity should have at least the
# Group Admin role in Google Admin. More info: https://support.google.com/a/answer/2405986

module "cs-gg-agentpay-engineer-prod-svc" {
  source  = "terraform-google-modules/group/google"
  version = "~> 0.6"

  id           = "agentpay-engineer-prod-svc@synapse-network.ai"
  display_name = "agentpay-engineer-prod-svc"
  customer_id  = data.google_organization.org.directory_customer_id
  owners = [
    "cliff@synapse-network.ai",
  ]
  types = [
    "default",
    "security",
  ]
}

module "cs-gg-agentpay-engineer-staging-svc" {
  source  = "terraform-google-modules/group/google"
  version = "~> 0.6"

  id           = "agentpay-engineer-staging-svc@synapse-network.ai"
  display_name = "agentpay-engineer-staging-svc"
  customer_id  = data.google_organization.org.directory_customer_id
  owners = [
    "cliff@synapse-network.ai",
  ]
  types = [
    "default",
    "security",
  ]
}

module "cs-gg-agentpay-security-prod-svc" {
  source  = "terraform-google-modules/group/google"
  version = "~> 0.6"

  id           = "agentpay-security-prod-svc@synapse-network.ai"
  display_name = "agentpay-security-prod-svc"
  customer_id  = data.google_organization.org.directory_customer_id
  types = [
    "default",
    "security",
  ]
}

module "cs-gg-agentpay-security-staging-svc" {
  source  = "terraform-google-modules/group/google"
  version = "~> 0.6"

  id           = "agentpay-security-staging-svc@synapse-network.ai"
  display_name = "agentpay-security-staging-svc"
  customer_id  = data.google_organization.org.directory_customer_id
  types = [
    "default",
    "security",
  ]
}
