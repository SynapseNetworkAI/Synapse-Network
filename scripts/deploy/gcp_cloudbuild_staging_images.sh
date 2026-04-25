#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}}"
REGION="${REGION:-us-central1}"
REPOSITORY="${ARTIFACT_REGISTRY_REPOSITORY:-synapse-staging}"
TAG="${TAG:-staging-$(date -u +%Y%m%dT%H%M%SZ)}"
SERVICES="gateway,gateway-admin,user-front,admin-front"
JSON_OUTPUT=""
BUILD_BACKEND="${STAGING_IMAGE_BUILD_BACKEND:-local-docker}"

shift_if_project=false
if [[ $# -gt 0 && "${1:-}" != --* ]]; then
  shift_if_project=true
fi
if [[ "${shift_if_project}" == "true" ]]; then
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --services)
      SERVICES="${2:-}"
      shift 2
      ;;
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --json-output)
      JSON_OUTPUT="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Usage: bash scripts/deploy/gcp_cloudbuild_staging_images.sh <gcp-project-id> [--services gateway,user-front|all] [--tag <tag>] [--json-output <path>]" >&2
  exit 2
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_cmd gcloud
require_cmd mktemp

registry="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"
gateway_image="${registry}/gateway:${TAG}"
gateway_admin_image="${registry}/gateway-admin:${TAG}"
user_front_image="${registry}/user-front:${TAG}"
admin_front_image="${registry}/admin-front:${TAG}"

IFS=',' read -r -a requested_services <<<"${SERVICES}"
normalized_services=()
for service in "${requested_services[@]}"; do
  service="$(echo "${service}" | xargs)"
  [[ -z "${service}" ]] && continue
  if [[ "${service}" == "all" ]]; then
    normalized_services=(gateway gateway-admin user-front admin-front)
    break
  fi
  case "${service}" in
    gateway|gateway-admin|user-front|admin-front)
      normalized_services+=("${service}")
      ;;
    *)
      echo "invalid service in --services: ${service}" >&2
      exit 2
      ;;
  esac
done

if [[ ${#normalized_services[@]} -eq 0 ]]; then
  echo "no services requested; nothing to build" >&2
  exit 2
fi

contains_service() {
  local needle="$1"
  local item
  for item in "${normalized_services[@]}"; do
    [[ "${item}" == "${needle}" ]] && return 0
  done
  return 1
}

tmp_config="$(mktemp -t synapse-staging-cloudbuild.XXXXXX.yaml)"
cleanup() {
  rm -f "${tmp_config}"
}
trap cleanup EXIT

cat >"${tmp_config}" <<EOF
timeout: "3600s"
options:
  logging: CLOUD_LOGGING_ONLY
steps:
EOF

if contains_service gateway; then
  cat >>"${tmp_config}" <<EOF
  - name: "gcr.io/cloud-builders/docker"
    id: "build-gateway"
    args: ["build", "-t", "${gateway_image}", "services/gateway"]
  - name: "gcr.io/cloud-builders/docker"
    id: "push-gateway"
    args: ["push", "${gateway_image}"]
    waitFor: ["build-gateway"]

EOF
fi

if contains_service gateway-admin; then
  cat >>"${tmp_config}" <<EOF
  - name: "gcr.io/cloud-builders/docker"
    id: "build-gateway-admin"
    args: ["build", "-f", "services/gateway-admin/Dockerfile", "-t", "${gateway_admin_image}", "."]
  - name: "gcr.io/cloud-builders/docker"
    id: "push-gateway-admin"
    args: ["push", "${gateway_admin_image}"]
    waitFor: ["build-gateway-admin"]

EOF
fi

if contains_service user-front; then
  cat >>"${tmp_config}" <<EOF
  - name: "gcr.io/cloud-builders/docker"
    id: "build-user-front"
    args:
      - "build"
      - "--build-arg"
      - "NEXT_PUBLIC_GATEWAY_BASE_URL=${NEXT_PUBLIC_GATEWAY_BASE_URL:-https://api-staging.synapse-network.ai}"
      - "--build-arg"
      - "NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS=${NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS:-20000}"
      - "--build-arg"
      - "NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV:-staging}"
      - "--build-arg"
      - "NEXT_PUBLIC_SUPPORT_EMAIL=${NEXT_PUBLIC_SUPPORT_EMAIL:-support@synapse-network.ai}"
      - "--build-arg"
      - "NEXT_PUBLIC_SUPPORT_PORTAL_URL=${NEXT_PUBLIC_SUPPORT_PORTAL_URL:-}"
      - "--build-arg"
      - "NEXT_PUBLIC_REOWN_PROJECT_ID=${NEXT_PUBLIC_REOWN_PROJECT_ID:-}"
      - "--build-arg"
      - "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:-}"
      - "--build-arg"
      - "CONTRACT_CONFIG_SOURCE=${CONTRACT_CONFIG_SOURCE:-src/contract-config.arbitrum-sepolia.example.json}"
      - "-t"
      - "${user_front_image}"
      - "services/user-front"
  - name: "gcr.io/cloud-builders/docker"
    id: "push-user-front"
    args: ["push", "${user_front_image}"]
    waitFor: ["build-user-front"]

EOF
fi

if contains_service admin-front; then
  cat >>"${tmp_config}" <<EOF
  - name: "gcr.io/cloud-builders/docker"
    id: "build-admin-front"
    args:
      - "build"
      - "--build-arg"
      - "NEXT_PUBLIC_ADMIN_API_BASE_URL=${NEXT_PUBLIC_ADMIN_API_BASE_URL:-https://admin-api-staging.synapse-network.ai}"
      - "--build-arg"
      - "ADMIN_API_PROXY_TARGET=${ADMIN_API_PROXY_TARGET:-https://admin-api-staging.synapse-network.ai}"
      - "--build-arg"
      - "NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV:-staging}"
      - "-t"
      - "${admin_front_image}"
      - "services/admin-front"
  - name: "gcr.io/cloud-builders/docker"
    id: "push-admin-front"
    args: ["push", "${admin_front_image}"]
    waitFor: ["build-admin-front"]
EOF
fi

echo "[gcp-cloudbuild-images] project=${PROJECT_ID}"
echo "[gcp-cloudbuild-images] region=${REGION}"
echo "[gcp-cloudbuild-images] repository=${REPOSITORY}"
echo "[gcp-cloudbuild-images] tag=${TAG}"
echo "[gcp-cloudbuild-images] services=${normalized_services[*]}"
echo "[gcp-cloudbuild-images] build_backend=${BUILD_BACKEND}"

docker_build_and_push() {
  require_cmd docker

  gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

  if contains_service gateway; then
    docker build -t "${gateway_image}" services/gateway
    docker push "${gateway_image}"
  fi

  if contains_service gateway-admin; then
    docker build -t "${gateway_admin_image}" services/gateway-admin
    docker push "${gateway_admin_image}"
  fi

  if contains_service user-front; then
    docker build \
      --build-arg "NEXT_PUBLIC_GATEWAY_BASE_URL=${NEXT_PUBLIC_GATEWAY_BASE_URL:-https://api-staging.synapse-network.ai}" \
      --build-arg "NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS=${NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS:-20000}" \
      --build-arg "NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV:-staging}" \
      --build-arg "NEXT_PUBLIC_SUPPORT_EMAIL=${NEXT_PUBLIC_SUPPORT_EMAIL:-support@synapse-network.ai}" \
      --build-arg "NEXT_PUBLIC_SUPPORT_PORTAL_URL=${NEXT_PUBLIC_SUPPORT_PORTAL_URL:-}" \
      --build-arg "NEXT_PUBLIC_REOWN_PROJECT_ID=${NEXT_PUBLIC_REOWN_PROJECT_ID:-}" \
      --build-arg "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:-}" \
      --build-arg "CONTRACT_CONFIG_SOURCE=${CONTRACT_CONFIG_SOURCE:-src/contract-config.arbitrum-sepolia.example.json}" \
      -t "${user_front_image}" \
      services/user-front
    docker push "${user_front_image}"
  fi

  if contains_service admin-front; then
    docker build \
      --build-arg "NEXT_PUBLIC_ADMIN_API_BASE_URL=${NEXT_PUBLIC_ADMIN_API_BASE_URL:-https://admin-api-staging.synapse-network.ai}" \
      --build-arg "ADMIN_API_PROXY_TARGET=${ADMIN_API_PROXY_TARGET:-https://admin-api-staging.synapse-network.ai}" \
      --build-arg "NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV:-staging}" \
      -t "${admin_front_image}" \
      services/admin-front
    docker push "${admin_front_image}"
  fi
}

case "${BUILD_BACKEND}" in
  local-docker)
    echo "[gcp-cloudbuild-images] building images locally on GitHub runner"
    docker_build_and_push
    ;;
  cloudbuild)
    echo "[gcp-cloudbuild-images] submitting build to Cloud Build"
    gcloud builds submit . \
      --project="${PROJECT_ID}" \
      --config="${tmp_config}"
    ;;
  *)
    echo "invalid STAGING_IMAGE_BUILD_BACKEND: ${BUILD_BACKEND}" >&2
    exit 2
    ;;
esac

json_services="{"
first=true
add_json_image() {
  local key="$1"
  local value="$2"
  if [[ "${first}" != "true" ]]; then
    json_services+=","
  fi
  first=false
  json_services+="\"${key}\":\"${value}\""
}
contains_service gateway && add_json_image gateway "${gateway_image}"
contains_service gateway-admin && add_json_image gateway-admin "${gateway_admin_image}"
contains_service user-front && add_json_image user-front "${user_front_image}"
contains_service admin-front && add_json_image admin-front "${admin_front_image}"
json_services+="}"

if [[ -n "${JSON_OUTPUT}" ]]; then
  cat >"${JSON_OUTPUT}" <<EOF
{
  "tag": "${TAG}",
  "registry": "${registry}",
  "services": ${json_services}
}
EOF
fi

echo
echo "[gcp-cloudbuild-images] pushed images:"
contains_service gateway && echo "gateway_image       = \"${gateway_image}\""
contains_service gateway-admin && echo "gateway_admin_image = \"${gateway_admin_image}\""
contains_service user-front && echo "user_front_image    = \"${user_front_image}\""
contains_service admin-front && echo "admin_front_image   = \"${admin_front_image}\""
echo
echo "For automated deploys, use the JSON output and deploy by immutable digest when available."
