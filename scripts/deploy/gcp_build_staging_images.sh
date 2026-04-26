#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}}"
REGION="${REGION:-us-central1}"
REPOSITORY="${ARTIFACT_REGISTRY_REPOSITORY:-synapse-staging}"
TAG="${TAG:-staging-$(date -u +%Y-%m-%d-%H%M%S)}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Usage: bash scripts/deploy/gcp_build_staging_images.sh <gcp-project-id>" >&2
  exit 2
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_cmd docker
require_cmd gcloud

registry="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"
gateway_image="${registry}/gateway:${TAG}"
gateway_admin_image="${registry}/gateway-admin:${TAG}"
user_front_image="${registry}/user-front:${TAG}"
admin_front_image="${registry}/admin-front:${TAG}"

echo "[gcp-build-images] project=${PROJECT_ID}"
echo "[gcp-build-images] region=${REGION}"
echo "[gcp-build-images] repository=${REPOSITORY}"
echo "[gcp-build-images] tag=${TAG}"

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

echo "[gcp-build-images] building gateway"
docker build --platform linux/amd64 -t "${gateway_image}" services/gateway
docker push "${gateway_image}"

echo "[gcp-build-images] building gateway-admin"
docker build --platform linux/amd64 -f services/gateway-admin/Dockerfile -t "${gateway_admin_image}" .
docker push "${gateway_admin_image}"

echo "[gcp-build-images] building user-front"
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_GATEWAY_BASE_URL="${NEXT_PUBLIC_GATEWAY_BASE_URL:-https://api-staging.synapse-network.ai}" \
  --build-arg NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS="${NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS:-20000}" \
  --build-arg NEXT_PUBLIC_APP_ENV="${NEXT_PUBLIC_APP_ENV:-staging}" \
  --build-arg NEXT_PUBLIC_SUPPORT_EMAIL="${NEXT_PUBLIC_SUPPORT_EMAIL:-support@synapse-network.ai}" \
  --build-arg NEXT_PUBLIC_SUPPORT_PORTAL_URL="${NEXT_PUBLIC_SUPPORT_PORTAL_URL:-}" \
  --build-arg NEXT_PUBLIC_REOWN_PROJECT_ID="${NEXT_PUBLIC_REOWN_PROJECT_ID:-}" \
  --build-arg NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:-}" \
  --build-arg CONTRACT_CONFIG_SOURCE="${CONTRACT_CONFIG_SOURCE:-src/contract-config.arbitrum-sepolia.example.json}" \
  -t "${user_front_image}" \
  services/user-front
docker push "${user_front_image}"

echo "[gcp-build-images] building admin-front"
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_ADMIN_API_BASE_URL="${NEXT_PUBLIC_ADMIN_API_BASE_URL:-https://admin-api-staging.synapse-network.ai}" \
  --build-arg ADMIN_API_PROXY_TARGET="${ADMIN_API_PROXY_TARGET:-https://admin-api-staging.synapse-network.ai}" \
  --build-arg NEXT_PUBLIC_APP_ENV="${NEXT_PUBLIC_APP_ENV:-staging}" \
  -t "${admin_front_image}" \
  services/admin-front
docker push "${admin_front_image}"

cat <<EOF

[gcp-build-images] pushed images:
gateway_image       = "${gateway_image}"
gateway_admin_image = "${gateway_admin_image}"
user_front_image    = "${user_front_image}"
admin_front_image   = "${admin_front_image}"

Add the block above to infra/terraform/gcp-staging/terraform.tfvars.
EOF
