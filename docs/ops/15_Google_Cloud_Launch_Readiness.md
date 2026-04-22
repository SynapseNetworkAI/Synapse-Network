---
title: Google Cloud Launch Readiness
status: active
owner: ops
last_reviewed: 2026-04-22
---

# Google Cloud Launch Readiness

This document is the Google Cloud staging/prod readiness plan for Synapse
Network. It defines the tooling, staging topology, email setup, production
blockers, and evidence required before launch.

## Tooling Decision

Use Google Cloud official tooling, but keep production control inside Synapse
release gates:

1. `Cloud Shell` for first setup and one-off operations.
2. `gcloud CLI` for project, IAM, VM, API, and Secret Manager operations.
3. Terraform for reproducible infrastructure.
4. Gemini CLI / Cloud Assist only as an assistant for command generation and
   troubleshooting; do not let it bypass evidence gates.
5. Gmail SMTP or Google Workspace SMTP relay for outbound notification email,
   delivered through the async notification outbox worker.

Official references:

1. <https://docs.cloud.google.com/sdk/gcloud>
2. <https://docs.cloud.google.com/shell/docs/use-cloud-shell-terminal>
3. <https://docs.cloud.google.com/docs/terraform>
4. <https://docs.cloud.google.com/gemini/docs/codeassist/gemini-cli>
5. <https://support.google.com/a/answer/176600>
6. <https://support.google.com/a/answer/166852>
7. <https://support.google.com/a/answer/2956491>

## Current Staging Shape

V1 staging is one GCE VM running Docker Compose:

1. Gateway
2. Gateway-admin
3. User-front
4. Admin-front
5. Provider runtime fixture
6. Postgres
7. Redis
8. Kafka
9. ClickHouse
10. Nginx or Caddy
11. Prometheus, Grafana, Alertmanager
12. Gmail notification worker
13. Lark alert relay or Alertmanager webhook routing

Terraform scaffold:

```bash
cd infra/terraform/gcp-staging
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

Preflight:

```bash
bash scripts/deploy/gcp_preflight.sh <gcp-project-id>
```

The preflight verifies `gcloud`, Terraform, project access, billing, and required
GCP APIs. It may enable missing APIs. Run it from Cloud Shell or a trusted local
machine.

## Google Cloud Infrastructure Checklist

Before staging evidence:

1. GCP project exists and billing is enabled.
2. Required APIs are enabled:
   - Compute Engine
   - Secret Manager
   - Artifact Registry
   - Cloud Resource Manager
   - IAM
   - Logging
   - Monitoring
   - Cloud Storage
3. Staging VM is created by Terraform.
4. Static IP is attached.
5. DNS points staging domain to the static IP.
6. TLS is configured by reverse proxy.
7. SSH is restricted to IAP or explicit CIDR allowlist.
8. Postgres, Redis, Kafka, and ClickHouse ports are not publicly exposed.
9. Secrets are injected from Secret Manager or protected environment files.
10. GCS backup bucket exists for recovery drill artifacts.
11. Ops Agent, disk alerts, and process/health monitoring are enabled.

## Email Readiness

V1 email uses Gmail SMTP or Google Workspace SMTP relay.

Required:

1. Dedicated staging sender mailbox.
2. Dedicated production sender mailbox.
3. App password or SMTP relay configured outside git.
4. SPF, DKIM, and DMARC configured.
5. Gmail daily quota alert enabled.
6. `notification-outbox` worker deployed.
7. Test email evidence generated.

Environment variables are documented in
`docs/ops/14_Gmail_Email_Notifications.md` and gateway `.env.*.example` files.

Email is not a P0 incident channel. P0 incidents still use Lark/Prometheus.

## Current Production NO-GO Blockers

Production is still `NO-GO` until all items below have evidence:

1. Gateway full-chain staging E2E:
   - `npm run release:evidence:gateway-fullchain:staging`
   - `GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence`
2. One-ticket withdrawal 10-scenario evidence:
   - `npm run e2e:withdrawal-one-ticket-evidence`
   - `npm run ci:withdrawal-one-ticket-evidence`
3. Contract release evidence:
   - fork test output
   - deployment dry-run
   - ABI hash
   - bytecode hash
   - source verification link
   - constructor args verification
   - production release manifest
   - small-value chain rehearsal tx hashes
4. Production-grade load and concurrency evidence:
   - invoke
   - balance
   - withdrawal
   - deposit confirm
   - provider health
   - admin finance views
   - high-concurrency money safety
5. Ledger/vault reconciliation report.
6. Monitoring and alert evidence:
   - dashboards
   - alert drill screenshots
   - `/metrics` proxy allowlist proof
   - on-call route
   - escalation policy
   - incident template
   - customer communication template
   - postmortem template
7. Backup/restore drill:
   - `SYNAPSE_DRILL_ENV=staging SYNAPSE_DRILL_CONFIRM=I_UNDERSTAND_THIS_CHANGES_STAGING npm run drill:backup-restore:staging`
   - `npm run ci:backup-restore-evidence`
8. Production config review:
   - contract addresses
   - chain id and RPC endpoints
   - USDC address
   - CORS allowlist
   - JWT/TOTP/internal token handling
   - DB TLS and least privilege
   - backup retention
   - secret storage proof
   - owner/multisig/signer proof
9. Sign-off from engineering, security, finance/ledger, and operations owners.

## Recommended Execution Order

1. Create GCP staging infrastructure through Terraform.
2. Deploy Docker Compose staging stack.
3. Configure Lark alert routes and run Lark E2E evidence.
4. Configure Gmail sender and run email notification evidence.
5. Configure Prometheus/Grafana/Alertmanager and drill alerts.
6. Run Gateway full-chain release E2E in staging.
7. Run one-ticket withdrawal 10-scenario evidence.
8. Run local and staging load/reconciliation evidence.
9. Run backup/restore drill.
10. Attach all evidence to production validation.
11. Only then prepare production infrastructure and small-value rehearsal.

## Hard Rules

1. Do not use local CI as production evidence.
2. Do not put secrets in Terraform variables, git, screenshots, or evidence.
3. Do not expose Postgres, Kafka, ClickHouse, Redis, or `/metrics` publicly.
4. Do not run destructive restore against production.
5. Do not represent internal audit as third-party audit.
6. Do not launch production while validation remains `NO-GO`.
