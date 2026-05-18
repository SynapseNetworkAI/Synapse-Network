#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/deploy/gcp_env.sh
source "${ROOT_DIR}/scripts/deploy/gcp_env.sh"

ENVIRONMENT=""
RECEIVER_URL=""
RECEIVER_TOKEN="${GCP_ALERT_RECEIVER_TOKEN:-}"
RECEIVER_USERNAME="${GCP_ALERT_RECEIVER_USERNAME:-synapse-gcp-alert}"
UPTIME_REGIONS="${UPTIME_REGIONS:-usa-iowa,usa-oregon,asia-pacific}"

usage() {
  cat >&2 <<'EOF'
Usage:
  GCP_ALERT_RECEIVER_TOKEN=<token> bash scripts/deploy/gcp_configure_alerts.sh --env staging --project <project> --receiver-url <url>
  GCP_ALERT_RECEIVER_TOKEN=<token> bash scripts/deploy/gcp_configure_alerts.sh --env prod --project <project> --receiver-url <url>
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
    --receiver-url)
      RECEIVER_URL="${2:-}"
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

[[ -n "${PROJECT_ID}" ]] || { echo "missing --project or PROJECT_ID" >&2; usage; exit 2; }
[[ -n "${RECEIVER_URL}" ]] || { echo "missing --receiver-url" >&2; usage; exit 2; }
[[ -n "${RECEIVER_TOKEN}" ]] || { echo "missing GCP_ALERT_RECEIVER_TOKEN" >&2; exit 2; }

for tool in gcloud python3; do
  synapse_require_cmd "${tool}"
done

env_title="$(tr '[:lower:]' '[:upper:]' <<< "${ENVIRONMENT:0:1}")${ENVIRONMENT:1}"
channel_display_name="Synapse ${env_title} Lark Gateway-admin Receiver"

echo "[gcp-alerts] env=${ENVIRONMENT}"
echo "[gcp-alerts] project=${PROJECT_ID}"
echo "[gcp-alerts] receiver=${RECEIVER_URL}"

gcloud config set project "${PROJECT_ID}" >/dev/null
gcloud services enable monitoring.googleapis.com logging.googleapis.com --project "${PROJECT_ID}" >/dev/null

channel_name="$(
  gcloud alpha monitoring channels list \
    --project "${PROJECT_ID}" \
    --filter="displayName=\"${channel_display_name}\"" \
    --format='value(name)' | head -n 1
)"

if [[ -z "${channel_name}" ]]; then
  echo "[gcp-alerts] creating webhook notification channel"
  gcloud alpha monitoring channels create \
    --project "${PROJECT_ID}" \
    --display-name="${channel_display_name}" \
    --description="Routes ${ENVIRONMENT} GCP Monitoring alerts to gateway-admin." \
    --type=webhook_basicauth \
    --user-labels="env=${ENVIRONMENT},system=synapse,managed_by=synapse-script" \
    --channel-labels="url=${RECEIVER_URL},username=${RECEIVER_USERNAME},password=${RECEIVER_TOKEN}" \
    >/dev/null
else
  echo "[gcp-alerts] reusing notification channel: ${channel_name}"
fi

upsert_uptime_check() {
  local display_name="$1"
  local host="$2"
  local path="$3"
  local existing
  existing="$(
    gcloud monitoring uptime list-configs \
      --project "${PROJECT_ID}" \
      --filter="displayName=\"${display_name}\"" \
      --format='value(name)' | head -n 1
  )"
  if [[ -z "${existing}" ]]; then
    echo "[gcp-alerts] creating uptime check: ${display_name}" >&2
    gcloud monitoring uptime create "${display_name}" \
      --project "${PROJECT_ID}" \
      --resource-type=uptime-url \
      --resource-labels="host=${host},project_id=${PROJECT_ID}" \
      --protocol=https \
      --path="${path}" \
      --port=443 \
      --request-method=get \
      --period=1 \
      --timeout=10 \
      --regions="${UPTIME_REGIONS}" \
      --validate-ssl=true \
      --status-classes=2xx \
      --user-labels="env=${ENVIRONMENT},system=synapse,managed_by=synapse-script" \
      >/dev/null
    return
  fi

  echo "[gcp-alerts] updating uptime check: ${display_name}" >&2
  gcloud monitoring uptime update "${existing}" \
    --project "${PROJECT_ID}" \
    --path="${path}" \
    --period=1 \
    --timeout=10 \
    --set-regions="${UPTIME_REGIONS}" \
    --validate-ssl=true \
    --set-status-classes=2xx \
    --update-user-labels="env=${ENVIRONMENT},system=synapse,managed_by=synapse-script" \
    >/dev/null
}

upsert_uptime_check "Synapse ${env_title} Gateway Health Uptime" "${GATEWAY_HOST}" "/health"
upsert_uptime_check "Synapse ${env_title} Gateway Readiness Uptime" "${GATEWAY_HOST}" "/readiness"
upsert_uptime_check "Synapse ${env_title} User Front Uptime" "${USER_FRONT_HOST}" "/"
upsert_uptime_check "Synapse ${env_title} Admin API Health Uptime" "${ADMIN_API_HOST}" "/health"

echo "[gcp-alerts] ok"
