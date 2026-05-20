#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}}"
REGION="${REGION:-us-central1}"
TAG="${TAG:-staging-$(date -u +%Y-%m-%d-%H%M%S)}"
frontend_app_env="${NEXT_PUBLIC_APP_ENV:-staging}"
if [[ "${frontend_app_env}" == "prod" || "${frontend_app_env}" == "production" ]]; then
  default_repository="synapse-prod"
else
  default_repository="synapse-staging"
fi
REPOSITORY="${ARTIFACT_REGISTRY_REPOSITORY:-${default_repository}}"

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
docs_front_image="${registry}/docs-front:${TAG}"

if [[ "${frontend_app_env}" == "prod" || "${frontend_app_env}" == "production" ]]; then
  frontend_gateway_base_url="${NEXT_PUBLIC_GATEWAY_BASE_URL:-https://api.synapse-network.ai}"
  frontend_analytics_endpoint="${NEXT_PUBLIC_ANALYTICS_ENDPOINT:-https://api.synapse-network.ai/api/v1/events}"
  frontend_docs_base_url="${NEXT_PUBLIC_DOCS_BASE_URL:-https://docs.synapse-network.ai}"
  frontend_tx_explorer_base_url="${NEXT_PUBLIC_TX_EXPLORER_BASE_URL:-https://arbiscan.io}"
  frontend_rpc_url="${NEXT_PUBLIC_RPC_URL:-https://arb1.arbitrum.io/rpc}"
  frontend_contract_config_source="${CONTRACT_CONFIG_SOURCE:-src/contract-config.arbitrum-one.prod.json}"
else
  frontend_gateway_base_url="${NEXT_PUBLIC_GATEWAY_BASE_URL:-https://api-staging.synapse-network.ai}"
  frontend_analytics_endpoint="${NEXT_PUBLIC_ANALYTICS_ENDPOINT:-https://api-staging.synapse-network.ai/api/v1/events}"
  frontend_docs_base_url="${NEXT_PUBLIC_DOCS_BASE_URL:-https://docs-staging.synapse-network.ai}"
  frontend_tx_explorer_base_url="${NEXT_PUBLIC_TX_EXPLORER_BASE_URL:-https://sepolia.arbiscan.io}"
  frontend_rpc_url="${NEXT_PUBLIC_RPC_URL:-https://sepolia-rollup.arbitrum.io/rpc}"
  frontend_contract_config_source="${CONTRACT_CONFIG_SOURCE:-src/contract-config.arbitrum-sepolia.example.json}"
fi

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
  --build-arg NEXT_PUBLIC_GATEWAY_BASE_URL="${frontend_gateway_base_url}" \
  --build-arg NEXT_PUBLIC_ANALYTICS_ENDPOINT="${frontend_analytics_endpoint}" \
  --build-arg NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS="${NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS:-20000}" \
  --build-arg NEXT_PUBLIC_APP_ENV="${frontend_app_env}" \
  --build-arg NEXT_PUBLIC_DOCS_BASE_URL="${frontend_docs_base_url}" \
  --build-arg NEXT_PUBLIC_TX_EXPLORER_BASE_URL="${frontend_tx_explorer_base_url}" \
  --build-arg NEXT_PUBLIC_RPC_URL="${frontend_rpc_url}" \
  --build-arg NEXT_PUBLIC_SUPPORT_EMAIL="${NEXT_PUBLIC_SUPPORT_EMAIL:-support@synapse-network.ai}" \
  --build-arg NEXT_PUBLIC_SUPPORT_PORTAL_URL="${NEXT_PUBLIC_SUPPORT_PORTAL_URL:-}" \
  --build-arg NEXT_PUBLIC_REOWN_PROJECT_ID="${NEXT_PUBLIC_REOWN_PROJECT_ID:-}" \
  --build-arg NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:-}" \
  --build-arg CONTRACT_CONFIG_SOURCE="${frontend_contract_config_source}" \
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

echo "[gcp-build-images] building docs-front"
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_APP_ENV="${NEXT_PUBLIC_APP_ENV:-staging}" \
  --build-arg NEXT_PUBLIC_DOCS_BASE_URL="${NEXT_PUBLIC_DOCS_BASE_URL:-https://docs-staging.synapse-network.ai}" \
  --build-arg NEXT_PUBLIC_CONSOLE_BASE_URL="${NEXT_PUBLIC_CONSOLE_BASE_URL:-https://staging.synapse-network.ai/dashboard/overview}" \
  --build-arg NEXT_PUBLIC_GATEWAY_BASE_URL="${NEXT_PUBLIC_GATEWAY_BASE_URL:-https://api-staging.synapse-network.ai}" \
  -t "${docs_front_image}" \
  services/docs-front
docker push "${docs_front_image}"

cat <<EOF

[gcp-build-images] pushed images:
gateway_image       = "${gateway_image}"
gateway_admin_image = "${gateway_admin_image}"
user_front_image    = "${user_front_image}"
admin_front_image   = "${admin_front_image}"
docs_front_image    = "${docs_front_image}"

Add the block above to infra/terraform/gcp-staging/terraform.tfvars.
EOF
