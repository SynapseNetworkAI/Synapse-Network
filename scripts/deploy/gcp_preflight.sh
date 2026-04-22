#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Usage: bash scripts/deploy/gcp_preflight.sh <gcp-project-id>" >&2
  exit 2
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_cmd gcloud
require_cmd terraform

echo "[gcp-preflight] project=${PROJECT_ID}"

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n1 || true)"
if [[ -z "${ACTIVE_ACCOUNT}" ]]; then
  echo "no active gcloud account. Run: gcloud auth login" >&2
  exit 1
fi
echo "[gcp-preflight] active account=${ACTIVE_ACCOUNT}"

if ! gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "project not accessible: ${PROJECT_ID}" >&2
  exit 1
fi

gcloud config set project "${PROJECT_ID}" >/dev/null

if ! gcloud beta billing projects describe "${PROJECT_ID}" --format='value(billingEnabled)' 2>/dev/null | grep -qi true; then
  echo "billing is not enabled or billing API access is missing for ${PROJECT_ID}" >&2
  exit 1
fi
echo "[gcp-preflight] billing enabled"

APIS=(
  compute.googleapis.com
  secretmanager.googleapis.com
  artifactregistry.googleapis.com
  cloudresourcemanager.googleapis.com
  iam.googleapis.com
  logging.googleapis.com
  monitoring.googleapis.com
  storage.googleapis.com
)

for api in "${APIS[@]}"; do
  if ! gcloud services list --enabled --filter="config.name:${api}" --format='value(config.name)' | grep -qx "${api}"; then
    echo "[gcp-preflight] enabling ${api}"
    gcloud services enable "${api}"
  else
    echo "[gcp-preflight] enabled ${api}"
  fi
done

echo "[gcp-preflight] ok"
