module "cs-svc-engineering-prod-svc-1442" {
  source  = "terraform-google-modules/project-factory/google//modules/svpc_service_project"
  version = "~> 18.0"

  name            = "agentpay-engineer-prod-svc"
  project_id      = "engineering-prod-svc-1442"
  org_id          = var.org_id
  billing_account = var.billing_account
  folder_id       = local.folder_map["Prod/AgentPay/Engineering"].id

  shared_vpc = module.cs-vpc-prod-shared.project_id
  shared_vpc_subnets = [
    try(module.cs-vpc-prod-shared.subnets["us-central1/subnet-prod-1"].self_link, ""),
    try(module.cs-vpc-prod-shared.subnets["us-west1/subnet-prod-2"].self_link, ""),
  ]

  domain     = data.google_organization.org.domain
  group_name = module.cs-gg-agentpay-engineer-prod-svc.name
  group_role = "roles/viewer"
  depends_on = [
    module.cs-org-policy-compute_skipDefaultNetworkCreation,
  ]
}

module "cs-svc-engineering-staging-svc-1442" {
  source  = "terraform-google-modules/project-factory/google//modules/svpc_service_project"
  version = "~> 18.0"

  name            = "agentpay-engineer-staging-svc"
  project_id      = "engineering-staging-svc-1442"
  org_id          = var.org_id
  billing_account = var.billing_account
  folder_id       = local.folder_map["Staging/AgentPay/Engineering"].id

  shared_vpc = module.cs-vpc-staging-shared.project_id
  shared_vpc_subnets = [
    try(module.cs-vpc-staging-shared.subnets["us-central1/subnet-staging-prod-1"].self_link, ""),
    try(module.cs-vpc-staging-shared.subnets["us-west1/subnet-staging-prod-2"].self_link, ""),
  ]

  domain     = data.google_organization.org.domain
  group_name = module.cs-gg-agentpay-engineer-staging-svc.name
  group_role = "roles/viewer"
  depends_on = [
    module.cs-org-policy-compute_skipDefaultNetworkCreation,
  ]
}

module "cs-svc-security-prod-svc-1442" {
  source  = "terraform-google-modules/project-factory/google//modules/svpc_service_project"
  version = "~> 18.0"

  name            = "agentpay-security-prod-svc"
  project_id      = "security-prod-svc-1442"
  org_id          = var.org_id
  billing_account = var.billing_account
  folder_id       = local.folder_map["Prod/AgentPay/Security"].id

  shared_vpc = module.cs-project-vpc-host-prod.project_id

  domain     = data.google_organization.org.domain
  group_name = module.cs-gg-agentpay-security-prod-svc.name
  group_role = "roles/viewer"
  depends_on = [
    module.cs-org-policy-compute_skipDefaultNetworkCreation,
  ]
}

module "cs-svc-security-staging-svc-1442" {
  source  = "terraform-google-modules/project-factory/google//modules/svpc_service_project"
  version = "~> 18.0"

  name            = "agentpay-security-staging-svc"
  project_id      = "security-staging-svc-1442"
  org_id          = var.org_id
  billing_account = var.billing_account
  folder_id       = local.folder_map["Staging/AgentPay/Security"].id

  shared_vpc = module.cs-project-vpc-host-nonprod.project_id

  domain     = data.google_organization.org.domain
  group_name = module.cs-gg-agentpay-security-staging-svc.name
  group_role = "roles/viewer"
  depends_on = [
    module.cs-org-policy-compute_skipDefaultNetworkCreation,
  ]
}
