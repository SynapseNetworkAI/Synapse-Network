#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/deploy/gcp_env.sh
source "${ROOT_DIR}/scripts/deploy/gcp_env.sh"

ENVIRONMENT=""
SERVICE=""
IMAGE=""
GATEWAY_IMAGE=""
GATEWAY_ADMIN_IMAGE=""
PROVIDER_IMAGE=""
DRY_RUN=false
RUN_SMOKE_JOBS=false
JOBS_CSV=""

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/gcp_sync_jobs.sh --env staging --service gateway --image <image>
  bash scripts/deploy/gcp_sync_jobs.sh --env prod --service all --gateway-image <img> --gateway-admin-image <img> [--provider-image <img>]

Options:
  --env      staging | prod
  --project  GCP project id
  --region   Cloud Run region
  --service  gateway | gateway-admin | provider | all
  --image    image for single-service mode
  --gateway-image / --gateway-admin-image / --provider-image
  --jobs     comma-separated explicit Cloud Run job names
  --dry-run
  --run-smoke-jobs
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
    --service)
      SERVICE="${2:-}"
      shift 2
      ;;
    --image)
      IMAGE="${2:-}"
      shift 2
      ;;
    --gateway-image)
      GATEWAY_IMAGE="${2:-}"
      shift 2
      ;;
    --gateway-admin-image)
      GATEWAY_ADMIN_IMAGE="${2:-}"
      shift 2
      ;;
    --provider-image)
      PROVIDER_IMAGE="${2:-}"
      shift 2
      ;;
    --jobs)
      JOBS_CSV="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --run-smoke-jobs)
      RUN_SMOKE_JOBS=true
      shift
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

[[ -n "${PROJECT_ID}" ]] || { echo "missing --project or PROJECT_ID" >&2; usage; exit 2; }
[[ -n "${SERVICE}" ]] || { echo "missing --service" >&2; usage; exit 2; }

synapse_require_cmd gcloud

gateway_jobs=(
  "${SYNAPSE_NAME_PREFIX}-db-migrate"
  "${SYNAPSE_NAME_PREFIX}-deposit-indexer"
  "${SYNAPSE_NAME_PREFIX}-consumer-withdraw-chain-recovery"
  "${SYNAPSE_NAME_PREFIX}-withdrawal-expiry-sweeper"
  "${SYNAPSE_NAME_PREFIX}-notification-outbox-drain"
  "${SYNAPSE_NAME_PREFIX}-in-app-notification-cleanup"
)
gateway_smoke_jobs=(
  "${SYNAPSE_NAME_PREFIX}-deposit-indexer"
  "${SYNAPSE_NAME_PREFIX}-consumer-withdraw-chain-recovery"
  "${SYNAPSE_NAME_PREFIX}-withdrawal-expiry-sweeper"
  "${SYNAPSE_NAME_PREFIX}-notification-outbox-drain"
)
gateway_admin_jobs=("${SYNAPSE_NAME_PREFIX}-gateway-admin-db-migrate")
provider_jobs=(
  "${SYNAPSE_NAME_PREFIX}-provider-onboarding"
  "${SYNAPSE_NAME_PREFIX}-provider-gpp-e2e"
)

requested_jobs=()
if [[ -n "${JOBS_CSV}" ]]; then
  IFS=',' read -r -a requested_jobs <<< "${JOBS_CSV}"
fi

job_requested() {
  local job="$1"
  if (( ${#requested_jobs[@]} == 0 )); then
    return 0
  fi
  local requested
  for requested in "${requested_jobs[@]}"; do
    if [[ "${job}" == "${requested//[[:space:]]/}" ]]; then
      return 0
    fi
  done
  return 1
}

update_jobs() {
  local family="$1"
  local image="$2"
  shift 2
  local job
  for job in "$@"; do
    if ! job_requested "${job}"; then
      continue
    fi
    echo "[gcp-sync-jobs] ${ENVIRONMENT}/${family}: ${job} -> ${image}"
    if [[ "${DRY_RUN}" == true ]]; then
      continue
    fi
    gcloud run jobs update "${job}" \
      --project="${PROJECT_ID}" \
      --region="${REGION}" \
      --image="${image}" >/dev/null

    if [[ "${RUN_SMOKE_JOBS}" == true ]]; then
      case "${job}" in
        *db-migrate|*provider-gpp-e2e)
          ;;
        *)
          echo "[gcp-sync-jobs] executing smoke job ${job}"
          gcloud run jobs execute "${job}" \
            --project="${PROJECT_ID}" \
            --region="${REGION}" \
            --wait >/dev/null
          ;;
      esac
    fi
  done
}

case "${SERVICE}" in
  gateway)
    [[ -n "${IMAGE}" ]] || { echo "missing --image for gateway" >&2; exit 2; }
    update_jobs gateway "${IMAGE}" "${gateway_jobs[@]}"
    ;;
  gateway-admin)
    [[ -n "${IMAGE}" ]] || { echo "missing --image for gateway-admin" >&2; exit 2; }
    update_jobs gateway-admin "${IMAGE}" "${gateway_admin_jobs[@]}"
    ;;
  provider)
    [[ -n "${IMAGE}" ]] || { echo "missing --image for provider" >&2; exit 2; }
    update_jobs provider "${IMAGE}" "${provider_jobs[@]}"
    ;;
  all)
    [[ -n "${GATEWAY_IMAGE}" ]] || { echo "missing --gateway-image" >&2; exit 2; }
    [[ -n "${GATEWAY_ADMIN_IMAGE}" ]] || { echo "missing --gateway-admin-image" >&2; exit 2; }
    update_jobs gateway "${GATEWAY_IMAGE}" "${gateway_jobs[@]}"
    update_jobs gateway-admin "${GATEWAY_ADMIN_IMAGE}" "${gateway_admin_jobs[@]}"
    if [[ -n "${PROVIDER_IMAGE}" ]]; then
      update_jobs provider "${PROVIDER_IMAGE}" "${provider_jobs[@]}"
    fi
    ;;
  *)
    echo "unsupported --service value: ${SERVICE}" >&2
    exit 2
    ;;
esac

echo "[gcp-sync-jobs] ok"
