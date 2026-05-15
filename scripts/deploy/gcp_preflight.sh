#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/deploy/gcp_env.sh
source "${ROOT_DIR}/scripts/deploy/gcp_env.sh"

ENVIRONMENT=""

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/gcp_preflight.sh --env staging --project <gcp-project-id>
  bash scripts/deploy/gcp_preflight.sh --env prod --project <gcp-project-id>

Options:
  --env      staging | prod
  --project  override GCP project id (otherwise PROJECT_ID / gcloud config)
  --region   override region (default us-central1)
EOF
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
    --region)
      REGION="${2:-}"
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
synapse_require_cmd terraform

echo "[gcp-preflight] env=${ENVIRONMENT}"
echo "[gcp-preflight] project=${PROJECT_ID}"
echo "[gcp-preflight] region=${REGION}"

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

billing_enabled_value="$(gcloud beta billing projects describe "${PROJECT_ID}" --format='value(billingEnabled)' 2>/dev/null || true)"
billing_enabled_value="$(printf '%s' "${billing_enabled_value}" | tr -d '[:space:]')"
case "${billing_enabled_value}" in
  true|TRUE|True)
    echo "[gcp-preflight] billing enabled"
    ;;
  false|FALSE|False)
    echo "billing is disabled for ${PROJECT_ID}" >&2
    exit 1
    ;;
  *)
    echo "[gcp-preflight] WARN: unable to verify billing via Billing API; continuing because project access is already confirmed." >&2
    ;;
esac

while IFS= read -r api; do
  [[ -n "${api}" ]] || continue
  if ! gcloud services list --enabled --project="${PROJECT_ID}" --filter="config.name:${api}" --format='value(config.name)' | grep -qx "${api}"; then
    echo "[gcp-preflight] enabling ${api}"
    gcloud services enable "${api}" --project="${PROJECT_ID}"
  else
    echo "[gcp-preflight] enabled ${api}"
  fi
done < <(synapse_required_gcp_apis)

echo "[gcp-preflight] ok"
