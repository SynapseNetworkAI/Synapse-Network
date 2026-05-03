#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}"
REGION="${REGION:-us-central1}"
SERVICES=""
JSON_OUTPUT="smoke.json"
DETAILS_OUTPUT="smoke-details.json"
MAX_RETRIES="${STAGING_SMOKE_MAX_RETRIES:-10}"
SLEEP_SECONDS="${STAGING_SMOKE_SLEEP_SECONDS:-10}"

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
    --services)
      SERVICES="${2:-}"
      shift 2
      ;;
    --json-output)
      JSON_OUTPUT="${2:-}"
      shift 2
      ;;
    --details-output)
      DETAILS_OUTPUT="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "${PROJECT_ID}" || -z "${SERVICES}" ]]; then
  echo "Usage: bash scripts/deploy/gcp_smoke_staging_services.sh --project <gcp-project-id> --services gateway,docs-front [--region us-central1] [--json-output smoke.json] [--details-output smoke-details.json]" >&2
  exit 2
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd gcloud
require_cmd mktemp
require_cmd node

cloud_run_service_name() {
  case "$1" in
    gateway) echo "synapse-staging-gateway" ;;
    gateway-admin) echo "synapse-staging-gateway-admin" ;;
    user-front) echo "synapse-staging-user-front" ;;
    admin-front) echo "synapse-staging-admin-front" ;;
    docs-front) echo "synapse-staging-docs-front" ;;
    *)
      echo "unsupported service for smoke check: $1" >&2
      return 2
      ;;
  esac
}

smoke_paths() {
  case "$1" in
    gateway) printf '/health\n/readiness\n' ;;
    gateway-admin) printf '/health\n' ;;
    user-front|admin-front|docs-front) printf '/\n' ;;
    *)
      echo "unsupported service for smoke paths: $1" >&2
      return 2
      ;;
  esac
}

tmp_status="$(mktemp -t synapse-staging-smoke-status.XXXXXX)"
tmp_details="$(mktemp -t synapse-staging-smoke-details.XXXXXX)"
cleanup() {
  rm -f "${tmp_status}" "${tmp_details}"
}
trap cleanup EXIT

TOKEN="${STAGING_SMOKE_IDENTITY_TOKEN:-}"
if [[ -z "${TOKEN}" ]]; then
  TOKEN="$(gcloud auth print-identity-token 2>/dev/null || true)"
fi

append_detail() {
  local service="$1"
  local url="$2"
  local path="$3"
  local status="$4"
  local attempts="$5"
  local last_http_status="$6"
  local duration_seconds="$7"
  local auth_used="$8"
  local error="$9"
  SERVICE="${service}" URL="${url}" PATH_VALUE="${path}" STATUS_VALUE="${status}" ATTEMPTS="${attempts}" LAST_HTTP_STATUS="${last_http_status}" DURATION_SECONDS="${duration_seconds}" AUTH_USED="${auth_used}" ERROR_VALUE="${error}" DETAILS_FILE="${tmp_details}" node - <<'NODE'
  const fs = require('fs')
  const payload = {
    service: process.env.SERVICE,
    url: process.env.URL,
    path: process.env.PATH_VALUE,
    status: process.env.STATUS_VALUE,
    attempts: Number(process.env.ATTEMPTS || 0),
    last_http_status: process.env.LAST_HTTP_STATUS || null,
    duration_seconds: Number(process.env.DURATION_SECONDS || 0),
    auth_used: process.env.AUTH_USED === 'true',
    error: process.env.ERROR_VALUE || null,
  }
  fs.appendFileSync(process.env.DETAILS_FILE, `${JSON.stringify(payload)}\n`)
NODE
}

curl_status() {
  local url="$1"
  shift
  curl -L -sS -o /dev/null -w "%{http_code}" "$@" "${url}" || printf '000'
}

check_path() {
  local service="$1"
  local base_url="$2"
  local path="$3"
  local target_url="${base_url%/}${path}"
  local attempt=1
  local last_http_status="000"
  local auth_used="false"
  local started_at
  started_at="$(date +%s)"

  while [[ "${attempt}" -le "${MAX_RETRIES}" ]]; do
    auth_used="false"
    last_http_status="$(curl_status "${target_url}")"
    if [[ "${last_http_status}" != "200" && -n "${TOKEN}" ]]; then
      auth_used="true"
      last_http_status="$(curl_status "${target_url}" -H "Authorization: Bearer ${TOKEN}")"
    fi
    if [[ "${last_http_status}" == "200" ]]; then
      append_detail "${service}" "${target_url}" "${path}" "passed" "${attempt}" "${last_http_status}" "$(( $(date +%s) - started_at ))" "${auth_used}" ""
      return 0
    fi
    echo "[staging-smoke] ${service} ${path} not ready: http=${last_http_status}; retry ${attempt}/${MAX_RETRIES}" >&2
    if [[ "${attempt}" -lt "${MAX_RETRIES}" ]]; then
      sleep "${SLEEP_SECONDS}"
    fi
    attempt=$((attempt + 1))
  done

  append_detail "${service}" "${target_url}" "${path}" "failed" "$((attempt - 1))" "${last_http_status}" "$(( $(date +%s) - started_at ))" "${auth_used}" "endpoint did not return HTTP 200"
  return 1
}

IFS=',' read -r -a requested_services <<<"${SERVICES}"
failed=0
for raw_service in "${requested_services[@]}"; do
  service="$(echo "${raw_service}" | xargs)"
  [[ -z "${service}" ]] && continue
  cloud_run_name="$(cloud_run_service_name "${service}")"
  url="$(gcloud run services describe "${cloud_run_name}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"
  if [[ -z "${url}" ]]; then
    append_detail "${service}" "" "" "failed" 0 "" 0 "false" "Cloud Run service URL was empty"
    printf '%s=failed\n' "${service}" >>"${tmp_status}"
    failed=1
    continue
  fi

  service_failed=0
  while IFS= read -r path; do
    [[ -z "${path}" ]] && continue
    if ! check_path "${service}" "${url}" "${path}"; then
      service_failed=1
    fi
  done < <(smoke_paths "${service}")

  if [[ "${service_failed}" -eq 0 ]]; then
    printf '%s=passed\n' "${service}" >>"${tmp_status}"
  else
    printf '%s=failed\n' "${service}" >>"${tmp_status}"
    failed=1
  fi
done

STATUS_FILE="${tmp_status}" DETAILS_FILE="${tmp_details}" JSON_OUTPUT="${JSON_OUTPUT}" DETAILS_OUTPUT="${DETAILS_OUTPUT}" node - <<'NODE'
const fs = require('fs')
const status = {}
for (const line of fs.readFileSync(process.env.STATUS_FILE, 'utf8').split('\n')) {
  if (!line.trim()) continue
  const [key, value] = line.split('=')
  status[key] = value
}
const details = fs
  .readFileSync(process.env.DETAILS_FILE, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
fs.writeFileSync(process.env.JSON_OUTPUT, `${JSON.stringify(status, null, 2)}\n`)
fs.writeFileSync(process.env.DETAILS_OUTPUT, `${JSON.stringify(details, null, 2)}\n`)
NODE

if [[ "${failed}" -ne 0 ]]; then
  echo "[staging-smoke] one or more services failed smoke checks" >&2
  exit 1
fi

echo "[staging-smoke] all requested services passed"
