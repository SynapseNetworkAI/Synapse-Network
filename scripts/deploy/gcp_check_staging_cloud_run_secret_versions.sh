#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}}"
ENVIRONMENT="${ENVIRONMENT:-staging}"

CLOUD_RUN_SECRET_IDS=(
  synapse-staging-postgres-dsn
  synapse-staging-postgres-password
  synapse-staging-jwt-secret
  synapse-staging-auth-secret
  synapse-staging-private-key
  synapse-staging-metrics-bearer-token
  synapse-staging-gateway-internal-jwt-secret
  synapse-staging-arbitrum-sepolia-rpc-url
  synapse-staging-gmail-username
  synapse-staging-gmail-app-password
  synapse-staging-alert-drill-token
  synapse-staging-postgres-migrator-password
  synapse-staging-admin-csrf-secret
  synapse-staging-admin-database-dsn
  synapse-staging-admin-database-migration-dsn
  synapse-staging-gateway-readonly-dsn
  synapse-staging-gateway-forum-write-dsn
  synapse-staging-gateway-admin-wallet
  synapse-staging-gcp-alert-receiver-token
  synapse-staging-lark-webhook-staging-drill
  synapse-staging-lark-secret-staging-drill
  synapse-staging-lark-webhook-p0
  synapse-staging-lark-secret-p0
  synapse-staging-lark-webhook-prod-alerts
  synapse-staging-lark-secret-prod-alerts
)

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/gcp_check_staging_cloud_run_secret_versions.sh <gcp-project-id>

Purpose:
  Verifies every Secret Manager secret referenced by staging Cloud Run
  services/jobs has at least one ENABLED version before Terraform or gcloud
  deploy creates a revision that uses :latest.

Notes:
  - This script never reads or prints secret values.
  - Terraform creates placeholders only; Cloud Run requires an enabled version.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

enabled_version_exists() {
  local secret_id="$1"
  gcloud secrets versions list "${secret_id}" \
    --project="${PROJECT_ID}" \
    --filter='state:ENABLED' \
    --sort-by='~createTime' \
    --limit=1 \
    --format='value(name)' 2>/dev/null | grep -q .
}

if [[ -z "${PROJECT_ID}" ]]; then
  usage
  exit 2
fi

if [[ "${ENVIRONMENT}" != "staging" ]]; then
  echo "refusing non-staging environment: ${ENVIRONMENT}" >&2
  exit 2
fi

require_cmd gcloud

ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [[ "${ACTIVE_PROJECT}" != "${PROJECT_ID}" ]]; then
  echo "active gcloud project mismatch: active=${ACTIVE_PROJECT:-<unset>} expected=${PROJECT_ID}" >&2
  echo "Agent fix: run gcloud config set project ${PROJECT_ID}, then retry." >&2
  exit 2
fi

echo "[gcp-secret-version-preflight] project=${PROJECT_ID}"
echo "[gcp-secret-version-preflight] checking Cloud Run referenced secrets"

missing=0
for secret_id in "${CLOUD_RUN_SECRET_IDS[@]}"; do
  if [[ ! "${secret_id}" =~ ^synapse-staging- ]]; then
    echo "FATAL GCP-SECRET-VERSION-001: non-staging secret id in preflight: ${secret_id}" >&2
    exit 2
  fi

  if ! gcloud secrets describe "${secret_id}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    printf '[missing-placeholder] %s\n' "${secret_id}" >&2
    missing=1
    continue
  fi

  if ! enabled_version_exists "${secret_id}"; then
    printf '[missing-enabled-version] %s\n' "${secret_id}" >&2
    missing=1
    continue
  fi

  printf '[ok] %s\n' "${secret_id}"
done

if [[ "${missing}" -ne 0 ]]; then
  cat >&2 <<'EOF'
FATAL GCP-SECRET-VERSION-001: one or more Cloud Run referenced secrets cannot
resolve :latest.

Why dangerous: Cloud Run validates Secret Manager references while creating a
new revision/job. A placeholder without an enabled version causes Terraform
apply or gcloud run deploy to fail after partially updating other resources.

Agent fix:
  1. Create missing placeholders with Terraform if needed.
  2. Add enabled versions with scripts/deploy/gcp_put_secret.sh or bootstrap.
  3. Rerun this preflight before deploying Cloud Run services/jobs.
EOF
  exit 1
fi

echo "[gcp-secret-version-preflight] ok"
