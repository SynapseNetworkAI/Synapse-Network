#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}"
REGION="${REGION:-us-central1}"
SERVICE=""
IMAGE=""
GATEWAY_IMAGE=""
GATEWAY_ADMIN_IMAGE=""
PROVIDER_IMAGE=""
DRY_RUN=false
RUN_SMOKE_JOBS=false
JSON_OUTPUT=""
JOBS_CSV=""

usage() {
  cat >&2 <<'USAGE'
Usage:
  bash scripts/deploy/gcp_sync_staging_jobs.sh --service gateway --image <image-or-digest>
  bash scripts/deploy/gcp_sync_staging_jobs.sh --service gateway-admin --image <image-or-digest>
  bash scripts/deploy/gcp_sync_staging_jobs.sh --service provider --image <image-or-digest>
  bash scripts/deploy/gcp_sync_staging_jobs.sh --service all --gateway-image <image> --gateway-admin-image <image> --provider-image <image>

Options:
  --project <id>              GCP project id. Defaults to PROJECT_ID / gcloud config.
  --region <region>           Cloud Run region. Defaults to us-central1.
  --service <name>            gateway | gateway-admin | provider | all.
  --image <image-or-digest>   Image used for a single service family.
  --gateway-image <image>     Gateway image for --service all.
  --gateway-admin-image <image>
  --provider-image <image>
  --dry-run                   Print planned updates only.
  --run-smoke-jobs            Execute safe smoke jobs after update.
  --jobs <csv>                Limit updates to specific Cloud Run job name(s).
  --json-output <path>        Write update evidence JSON.
USAGE
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --run-smoke-jobs)
      RUN_SMOKE_JOBS=true
      shift
      ;;
    --jobs)
      JOBS_CSV="${2:-}"
      shift 2
      ;;
    --json-output)
      JSON_OUTPUT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      ;;
  esac
done

[[ -n "${PROJECT_ID}" ]] || { echo "missing --project or PROJECT_ID" >&2; usage; }
[[ -n "${SERVICE}" ]] || { echo "missing --service" >&2; usage; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_cmd gcloud
require_cmd node

gateway_jobs=(
  synapse-staging-db-migrate
  synapse-staging-deposit-indexer
  synapse-staging-consumer-withdraw-chain-recovery
  synapse-staging-withdrawal-expiry-sweeper
  synapse-staging-notification-outbox-drain
  synapse-staging-in-app-notification-cleanup
)
gateway_smoke_jobs=(
  synapse-staging-deposit-indexer
  synapse-staging-consumer-withdraw-chain-recovery
  synapse-staging-withdrawal-expiry-sweeper
  synapse-staging-notification-outbox-drain
)
gateway_admin_jobs=(synapse-staging-gateway-admin-db-migrate)
provider_jobs=(
  synapse-staging-provider-onboarding
  synapse-staging-provider-gpp-e2e
)

gateway_admin_secret_env=(
  "METRICS_BEARER_TOKEN=synapse-staging-metrics-bearer-token:latest"
  "ADMIN_CSRF_SECRET=synapse-staging-admin-csrf-secret:latest"
  "ADMIN_DATABASE_DSN=synapse-staging-admin-database-dsn:latest"
  "ADMIN_DATABASE_MIGRATION_DSN=synapse-staging-admin-database-migration-dsn:latest"
  "ADMIN_TOTP_SECRET_ENCRYPTION_KEY=synapse-staging-admin-totp-secret-encryption-key:latest"
  "GATEWAY_READONLY_DSN=synapse-staging-gateway-readonly-dsn:latest"
  "GATEWAY_FORUM_WRITE_DSN=synapse-staging-gateway-forum-write-dsn:latest"
  "GATEWAY_INTERNAL_ADMIN_WALLET=synapse-staging-gateway-admin-wallet:latest"
  "GATEWAY_INTERNAL_JWT_SECRET=synapse-staging-gateway-internal-jwt-secret:latest"
  "GCP_ALERT_RECEIVER_TOKEN=synapse-staging-gcp-alert-receiver-token:latest"
  "LARK_WEBHOOK_STAGING_DRILL=synapse-staging-lark-webhook-staging-drill:latest"
  "LARK_SECRET_STAGING_DRILL=synapse-staging-lark-secret-staging-drill:latest"
  "LARK_WEBHOOK_P0_WAR_ROOM=synapse-staging-lark-webhook-p0:latest"
  "LARK_SECRET_P0_WAR_ROOM=synapse-staging-lark-secret-p0:latest"
  "LARK_WEBHOOK_PROD_ALERTS=synapse-staging-lark-webhook-prod-alerts:latest"
  "LARK_SECRET_PROD_ALERTS=synapse-staging-lark-secret-prod-alerts:latest"
)

gateway_service_name="synapse-staging-gateway"

gateway_job_env_flags=()

build_gateway_job_env_flags() {
  local gateway_service_url
  gateway_service_url="$(gcloud run services describe "${gateway_service_name}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --format='value(status.url)')"
  [[ -n "${gateway_service_url}" ]] || {
    echo "failed to resolve staging gateway service URL" >&2
    exit 1
  }
  gateway_job_env_flags=(
    --update-env-vars
    "DEPOSIT_INDEXER_TRIGGER_ENABLED=false,DEPOSIT_INDEXER_TRIGGER_URL=${gateway_service_url}/internal/jobs/deposit-indexer/trigger,NOTIFICATION_OUTBOX_TRIGGER_ENABLED=false,NOTIFICATION_OUTBOX_TRIGGER_URL=${gateway_service_url}/internal/jobs/notification-outbox/trigger,ALCHEMY_DEPOSIT_WEBHOOK_ENABLED=false"
  )
}

join_by_comma() {
  local IFS=,
  echo "$*"
}

requested_jobs=()
if [[ -n "${JOBS_CSV}" ]]; then
  IFS=',' read -r -a requested_jobs <<< "${JOBS_CSV}"
fi

tmp_json="$(mktemp -t synapse-staging-jobs.XXXXXX.json)"
cleanup() {
  rm -f "${tmp_json}"
}
trap cleanup EXIT
printf '{"updated":[],"smokeExecutions":[]}\n' >"${tmp_json}"

append_json_array_item() {
  local key="$1"
  local item_json="$2"
  node - "${tmp_json}" "${key}" "${item_json}" <<'NODE'
const fs = require('node:fs')
const [path, key, itemRaw] = process.argv.slice(2)
const data = JSON.parse(fs.readFileSync(path, 'utf8'))
data[key] ||= []
data[key].push(JSON.parse(itemRaw))
fs.writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
NODE
}

json_string() {
  node -e 'console.log(JSON.stringify(process.argv[1] || ""))' "$1"
}

extract_cloud_run_image() {
  node -e '
let source = "";
process.stdin.on("data", (chunk) => source += chunk);
process.stdin.on("end", () => {
  const resource = JSON.parse(source || "{}");
  const seen = new Set();
  function visit(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return "";
    seen.add(value);
    if (Array.isArray(value.containers)) {
      for (const container of value.containers) {
        if (container && typeof container.image === "string" && container.image) {
          return container.image;
        }
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return "";
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "containers") continue;
      const found = visit(item);
      if (found) return found;
    }
    return "";
  }
  console.log(visit(resource));
});
'
}

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

update_job_set() {
  local family="$1"
  local image="$2"
  shift 2
  local all_jobs=("$@")
  local jobs=()

  local candidate
  for candidate in "${all_jobs[@]}"; do
    if job_requested "${candidate}"; then
      jobs+=("${candidate}")
    fi
  done

  if (( ${#requested_jobs[@]} > 0 && ${#jobs[@]} == 0 )); then
    if [[ "${SERVICE}" == "all" ]]; then
      echo "no selected jobs for ${family}; skipping" >&2
      return 0
    fi
    echo "none of --jobs (${JOBS_CSV}) belong to ${family}" >&2
    exit 2
  fi

  [[ -n "${image}" ]] || { echo "missing image for ${family}" >&2; exit 2; }

  local job
  for job in "${jobs[@]}"; do
    echo "[gcp-sync-staging-jobs] ${family}: ${job} -> ${image}" >&2
    local update_flags=()
    if [[ "${family}" == "gateway" ]]; then
      if (( ${#gateway_job_env_flags[@]} == 0 )); then
        build_gateway_job_env_flags
      fi
      update_flags+=("${gateway_job_env_flags[@]}")
    fi
    if [[ "${family}" == "gateway-admin" ]]; then
      update_flags+=(
        --set-env-vars "ADMIN_GATEWAY_DEBUG=false,ADMIN_SESSION_COOKIE_SECURE=true"
        --set-secrets "$(join_by_comma "${gateway_admin_secret_env[@]}")"
      )
    fi
    if [[ "${DRY_RUN}" != "true" ]]; then
      if (( ${#update_flags[@]} > 0 )); then
        gcloud run jobs update "${job}" \
          --project "${PROJECT_ID}" \
          --region "${REGION}" \
          --image "${image}" \
          "${update_flags[@]}" \
          --quiet >/dev/null
      else
        gcloud run jobs update "${job}" \
          --project "${PROJECT_ID}" \
          --region "${REGION}" \
          --image "${image}" \
          --quiet >/dev/null
      fi
    fi

    local effective_image="${image}"
    if [[ "${DRY_RUN}" != "true" ]]; then
      effective_image="$(gcloud run jobs describe "${job}" \
        --project "${PROJECT_ID}" \
        --region "${REGION}" \
        --format=json | extract_cloud_run_image)"
    fi

    append_json_array_item "updated" "{\"family\":$(json_string "${family}"),\"job\":$(json_string "${job}"),\"requestedImage\":$(json_string "${image}"),\"effectiveImage\":$(json_string "${effective_image}"),\"dryRun\":${DRY_RUN}}"
  done
}

run_smoke_job() {
  local job="$1"
  echo "[gcp-sync-staging-jobs] smoke execute: ${job}" >&2
  if [[ "${DRY_RUN}" != "true" ]]; then
    gcloud run jobs execute "${job}" \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --wait >/dev/null
  fi
  append_json_array_item "smokeExecutions" "{\"job\":$(json_string "${job}"),\"status\":$(json_string "$([[ "${DRY_RUN}" == "true" ]] && echo dry-run || echo passed)")}"
}

case "${SERVICE}" in
  gateway)
    update_job_set gateway "${IMAGE}" "${gateway_jobs[@]}"
    if [[ "${RUN_SMOKE_JOBS}" == "true" ]]; then
      for job in "${gateway_smoke_jobs[@]}"; do
        if job_requested "${job}"; then
          run_smoke_job "${job}"
        fi
      done
    fi
    ;;
  gateway-admin)
    update_job_set gateway-admin "${IMAGE}" "${gateway_admin_jobs[@]}"
    ;;
  provider)
    update_job_set provider "${IMAGE}" "${provider_jobs[@]}"
    ;;
  all)
    [[ -n "${GATEWAY_IMAGE}" ]] || GATEWAY_IMAGE="${IMAGE}"
    update_job_set gateway "${GATEWAY_IMAGE}" "${gateway_jobs[@]}"
    [[ -z "${GATEWAY_ADMIN_IMAGE}" ]] || update_job_set gateway-admin "${GATEWAY_ADMIN_IMAGE}" "${gateway_admin_jobs[@]}"
    [[ -z "${PROVIDER_IMAGE}" ]] || update_job_set provider "${PROVIDER_IMAGE}" "${provider_jobs[@]}"
    if [[ "${RUN_SMOKE_JOBS}" == "true" ]]; then
      for job in "${gateway_smoke_jobs[@]}"; do
        if job_requested "${job}"; then
          run_smoke_job "${job}"
        fi
      done
    fi
    ;;
  *)
    echo "invalid --service: ${SERVICE}" >&2
    usage
    ;;
esac

if [[ -n "${JSON_OUTPUT}" ]]; then
  mkdir -p "$(dirname "${JSON_OUTPUT}")"
  cp "${tmp_json}" "${JSON_OUTPUT}"
fi

cat "${tmp_json}"
