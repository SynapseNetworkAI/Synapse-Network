#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  printf '%s' '<secret-value>' | bash scripts/deploy/gcp_put_secret.sh <synapse-staging-secret-id>

Environment:
  PROJECT_ID  Optional. If set, it must match the active gcloud project.

Notes:
  - Secret values must be provided through stdin, never as CLI arguments.
  - Only synapse-staging-* secret ids are accepted by this MVP helper.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

if [[ "$#" -ne 1 ]]; then
  usage
  exit 2
fi

SECRET_ID="$1"
if [[ ! "${SECRET_ID}" =~ ^synapse-staging-[a-z0-9-]+$ ]]; then
  echo "refusing to write non-staging secret id: ${SECRET_ID}" >&2
  echo "Agent fix: use a Secret Manager id beginning with synapse-staging-." >&2
  exit 2
fi

if [[ -t 0 ]]; then
  echo "missing secret value on stdin" >&2
  echo "Agent fix: pipe the value, e.g. printf '%s' '<value>' | bash scripts/deploy/gcp_put_secret.sh ${SECRET_ID}" >&2
  exit 2
fi

require_cmd gcloud

ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
PROJECT_ID="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-${ACTIVE_PROJECT}}}}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "missing PROJECT_ID and no active gcloud project is configured" >&2
  exit 2
fi

if [[ "${ACTIVE_PROJECT}" != "${PROJECT_ID}" ]]; then
  echo "active gcloud project mismatch: active=${ACTIVE_PROJECT:-<unset>} expected=${PROJECT_ID}" >&2
  echo "Agent fix: run gcloud config set project ${PROJECT_ID}, then retry." >&2
  exit 2
fi

if ! gcloud secrets describe "${SECRET_ID}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Secret Manager placeholder does not exist: ${SECRET_ID}" >&2
  echo "Agent fix: run Terraform apply for infra/terraform/gcp-staging first." >&2
  exit 1
fi

SECRET_VALUE="$(cat)"
if [[ -z "${SECRET_VALUE}" ]]; then
  echo "secret value from stdin is empty; refusing to create an empty secret version" >&2
  exit 2
fi

printf '%s' "${SECRET_VALUE}" | \
  gcloud secrets versions add "${SECRET_ID}" \
    --project="${PROJECT_ID}" \
    --data-file=- >/dev/null

LATEST_VERSION="$(gcloud secrets versions list "${SECRET_ID}" \
  --project="${PROJECT_ID}" \
  --sort-by='~createTime' \
  --limit=1 \
  --format='value(name)' 2>/dev/null || true)"

echo "[gcp-put-secret] secret=${SECRET_ID}"
echo "[gcp-put-secret] project=${PROJECT_ID}"
echo "[gcp-put-secret] version=${LATEST_VERSION:-created}"
echo "[gcp-put-secret] ok"
