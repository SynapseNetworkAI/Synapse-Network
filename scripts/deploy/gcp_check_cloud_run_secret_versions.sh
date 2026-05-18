#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/deploy/gcp_env.sh
source "${ROOT_DIR}/scripts/deploy/gcp_env.sh"

ENVIRONMENT=""

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/gcp_check_cloud_run_secret_versions.sh --env staging --project <gcp-project-id>
  bash scripts/deploy/gcp_check_cloud_run_secret_versions.sh --env prod --project <gcp-project-id>

Purpose:
  Verifies every Secret Manager secret referenced by Cloud Run services/jobs has
  at least one ENABLED version before deploy creates a revision that uses
  :latest.
EOF
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENVIRONMENT="${2:-}"
      shift 2
      ;;
    --project)
      PROJECT_ID="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

synapse_load_gcp_env "${ENVIRONMENT}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "missing --project or PROJECT_ID" >&2
  usage
  exit 2
fi

synapse_require_cmd gcloud

ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [[ "${ACTIVE_PROJECT}" != "${PROJECT_ID}" ]]; then
  echo "active gcloud project mismatch: active=${ACTIVE_PROJECT:-<unset>} expected=${PROJECT_ID}" >&2
  echo "Agent fix: run gcloud config set project ${PROJECT_ID}, then retry." >&2
  exit 2
fi

echo "[gcp-secret-version-preflight] env=${ENVIRONMENT}"
echo "[gcp-secret-version-preflight] project=${PROJECT_ID}"

missing=0
while IFS= read -r secret_id; do
  [[ -n "${secret_id}" ]] || continue

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
done < <(synapse_cloud_run_secret_ids)

if [[ "${missing}" -ne 0 ]]; then
  cat >&2 <<'EOF'
FATAL GCP-SECRET-VERSION-001: one or more Cloud Run referenced secrets cannot
resolve :latest.

Why dangerous: Cloud Run validates Secret Manager references while creating a
new revision/job. A placeholder without an enabled version causes Terraform
apply or gcloud run deploy to fail after partially updating other resources.
EOF
  exit 1
fi

echo "[gcp-secret-version-preflight] ok"
