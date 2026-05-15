#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/deploy/gcp_env.sh
source "${ROOT_DIR}/scripts/deploy/gcp_env.sh"

ENVIRONMENT=""
TAG="${TAG:-}"

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/gcp_build_images.sh --env staging --project <gcp-project-id>
  bash scripts/deploy/gcp_build_images.sh --env prod --project <gcp-project-id>

Options:
  --env      staging | prod
  --project  override GCP project id
  --region   override region
  --tag      image tag (defaults to <env>-<utc-timestamp>)
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
    --tag)
      TAG="${2:-}"
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

# Prevent a previously exported staging shell from bleeding chain/domain values
# into a prod image build. This script only accepts project/region/tag
# overrides, so the runtime routing inputs must come from the requested env.
unset GATEWAY_HOST
unset ADMIN_FRONT_HOST
unset ADMIN_API_HOST
unset DOCS_HOST
unset USER_FRONT_HOST
unset TX_EXPLORER_BASE_URL
unset PUBLIC_RPC_URL
unset USER_FRONT_CONTRACT_CONFIG_SOURCE
unset RPC_SECRET_ID

synapse_load_gcp_env "${ENVIRONMENT}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "missing --project or PROJECT_ID" >&2
  usage
  exit 2
fi

if [[ -z "${USER_FRONT_CONTRACT_CONFIG_SOURCE}" ]]; then
  echo "missing USER_FRONT_CONTRACT_CONFIG_SOURCE for ${ENVIRONMENT}" >&2
  echo "Agent fix: set USER_FRONT_CONTRACT_CONFIG_SOURCE to the environment-correct contract config JSON." >&2
  exit 2
fi

TAG="${TAG:-${ENVIRONMENT}-$(date -u +%Y-%m-%d-%H%M%S)}"

synapse_require_cmd docker
synapse_require_cmd gcloud

registry="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY_REPOSITORY}"
gateway_image="${registry}/gateway:${TAG}"
gateway_admin_image="${registry}/gateway-admin:${TAG}"
user_front_image="${registry}/user-front:${TAG}"
admin_front_image="${registry}/admin-front:${TAG}"
docs_front_image="${registry}/docs-front:${TAG}"

echo "[gcp-build-images] env=${ENVIRONMENT}"
echo "[gcp-build-images] project=${PROJECT_ID}"
echo "[gcp-build-images] region=${REGION}"
echo "[gcp-build-images] repository=${ARTIFACT_REGISTRY_REPOSITORY}"
echo "[gcp-build-images] tag=${TAG}"

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

echo "[gcp-build-images] building gateway"
docker build --platform linux/amd64 -t "${gateway_image}" "${ROOT_DIR}/services/gateway"
docker push "${gateway_image}"

echo "[gcp-build-images] building gateway-admin"
docker build --platform linux/amd64 -f "${ROOT_DIR}/services/gateway-admin/Dockerfile" -t "${gateway_admin_image}" "${ROOT_DIR}"
docker push "${gateway_admin_image}"

echo "[gcp-build-images] building user-front"
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_GATEWAY_BASE_URL="https://${GATEWAY_HOST}" \
  --build-arg NEXT_PUBLIC_ANALYTICS_ENDPOINT="https://${GATEWAY_HOST}/api/v1/events" \
  --build-arg NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS="${NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS:-20000}" \
  --build-arg NEXT_PUBLIC_APP_ENV="${ENVIRONMENT}" \
  --build-arg NEXT_PUBLIC_DOCS_BASE_URL="https://${DOCS_HOST}" \
  --build-arg NEXT_PUBLIC_TX_EXPLORER_BASE_URL="${TX_EXPLORER_BASE_URL}" \
  --build-arg NEXT_PUBLIC_RPC_URL="${PUBLIC_RPC_URL}" \
  --build-arg NEXT_PUBLIC_SUPPORT_EMAIL="${NEXT_PUBLIC_SUPPORT_EMAIL:-support@synapse-network.ai}" \
  --build-arg NEXT_PUBLIC_SUPPORT_PORTAL_URL="${NEXT_PUBLIC_SUPPORT_PORTAL_URL:-}" \
  --build-arg NEXT_PUBLIC_REOWN_PROJECT_ID="${NEXT_PUBLIC_REOWN_PROJECT_ID:-}" \
  --build-arg NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:-}" \
  --build-arg CONTRACT_CONFIG_SOURCE="${USER_FRONT_CONTRACT_CONFIG_SOURCE}" \
  -t "${user_front_image}" \
  "${ROOT_DIR}/services/user-front"
docker push "${user_front_image}"

echo "[gcp-build-images] building admin-front"
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_ADMIN_API_BASE_URL="${NEXT_PUBLIC_ADMIN_API_BASE_URL:-}" \
  --build-arg ADMIN_API_PROXY_TARGET="https://${ADMIN_API_HOST}" \
  --build-arg NEXT_PUBLIC_APP_ENV="${ENVIRONMENT}" \
  -t "${admin_front_image}" \
  "${ROOT_DIR}/services/admin-front"
docker push "${admin_front_image}"

echo "[gcp-build-images] building docs-front"
docker build --platform linux/amd64 \
  --pull \
  --no-cache \
  --build-arg NEXT_PUBLIC_APP_ENV="${ENVIRONMENT}" \
  --build-arg NEXT_PUBLIC_DOCS_BASE_URL="https://${DOCS_HOST}" \
  --build-arg NEXT_PUBLIC_CONSOLE_BASE_URL="https://${USER_FRONT_HOST}/dashboard/overview" \
  --build-arg NEXT_PUBLIC_GATEWAY_BASE_URL="https://${GATEWAY_HOST}" \
  -t "${docs_front_image}" \
  "${ROOT_DIR}/services/docs-front"
docker push "${docs_front_image}"

cat <<EOF

[gcp-build-images] pushed images:
gateway_image       = "${gateway_image}"
gateway_admin_image = "${gateway_admin_image}"
user_front_image    = "${user_front_image}"
admin_front_image   = "${admin_front_image}"
docs_front_image    = "${docs_front_image}"

Add the block above to infra/terraform/gcp-${ENVIRONMENT}/terraform.tfvars.
EOF
