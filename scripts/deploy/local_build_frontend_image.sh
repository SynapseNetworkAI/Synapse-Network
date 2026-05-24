#!/usr/bin/env bash
set -euo pipefail

SERVICE=""
ENVIRONMENT="staging"
REF="main"
RELEASE_TASK_ID=""
OPS_API_BASE_URL="${OPS_CONSOLE_API_BASE_URL:-http://127.0.0.1:9700/api}"
PROJECT_ID=""
REGION=""
REPOSITORY=""
ATTACH="true"

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/local_build_frontend_image.sh \
    --service admin-front|user-front|docs-front \
    --environment staging|production \
    --ref main \
    --release-task-id 123

Options:
  --service <name>              Frontend service to build.
  --environment <env>           staging or production. Default: staging.
  --ref <branch|sha>            Git ref to build from. Default: main.
  --release-task-id <id>        Ops Console ReleaseTask id to attach digest to.
  --ops-api-base-url <url>      Default: http://127.0.0.1:9700/api
  --project <gcp-project>       Override environment default project.
  --region <region>             Override environment default region.
  --repository <repo>           Override environment Artifact Registry repo.
  --no-attach                   Build and print digest without calling Ops Console.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service)
      SERVICE="${2:-}"
      shift 2
      ;;
    --environment)
      ENVIRONMENT="${2:-}"
      shift 2
      ;;
    --ref)
      REF="${2:-}"
      shift 2
      ;;
    --release-task-id)
      RELEASE_TASK_ID="${2:-}"
      shift 2
      ;;
    --ops-api-base-url)
      OPS_API_BASE_URL="${2:-}"
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
    --repository)
      REPOSITORY="${2:-}"
      shift 2
      ;;
    --no-attach)
      ATTACH="false"
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

case "${SERVICE}" in
  admin-front|user-front|docs-front) ;;
  *)
    echo "--service must be admin-front, user-front, or docs-front" >&2
    exit 2
    ;;
esac

case "${ENVIRONMENT}" in
  staging|production) ;;
  *)
    echo "--environment must be staging or production" >&2
    exit 2
    ;;
esac

if [[ "${ATTACH}" == "true" && -z "${RELEASE_TASK_ID}" ]]; then
  echo "--release-task-id is required unless --no-attach is set" >&2
  exit 2
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_cmd git
require_cmd docker
require_cmd gcloud
require_cmd node
if [[ "${ATTACH}" == "true" ]]; then
  require_cmd curl
fi

if [[ "${ENVIRONMENT}" == "production" ]]; then
  PROJECT_ID="${PROJECT_ID:-${PROD_GCP_PROJECT_ID:-synapse-network-prod}}"
  REGION="${REGION:-${PROD_GCP_REGION:-us-central1}}"
  REPOSITORY="${REPOSITORY:-${PROD_ARTIFACT_REGISTRY_REPOSITORY:-synapse-prod}}"
  export NEXT_PUBLIC_APP_ENV="prod"
  export NEXT_PUBLIC_GATEWAY_BASE_URL="https://api.synapse-network.ai"
  export NEXT_PUBLIC_ANALYTICS_ENDPOINT="https://api.synapse-network.ai/api/v1/events"
  export NEXT_PUBLIC_DOCS_BASE_URL="https://docs.synapse-network.ai"
  export NEXT_PUBLIC_CONSOLE_BASE_URL="https://www.synapse-network.ai/dashboard/overview"
  export NEXT_PUBLIC_ADMIN_API_BASE_URL=""
  export ADMIN_API_PROXY_TARGET="https://admin-api.synapse-network.ai"
  export NEXT_PUBLIC_TX_EXPLORER_BASE_URL="https://arbiscan.io"
  export NEXT_PUBLIC_RPC_URL="https://arb1.arbitrum.io/rpc"
  export CONTRACT_CONFIG_SOURCE="src/contract-config.arbitrum-one.prod.json"
else
  PROJECT_ID="${PROJECT_ID:-${STAGING_GCP_PROJECT_ID:-fabled-archive-494108-k5}}"
  REGION="${REGION:-${STAGING_GCP_REGION:-us-central1}}"
  REPOSITORY="${REPOSITORY:-${STAGING_ARTIFACT_REGISTRY_REPOSITORY:-synapse-staging}}"
fi

ROOT="$(git rev-parse --show-toplevel)"
TARGET_COMMIT="$(git -C "${ROOT}" rev-parse "${REF}^{commit}")"
SHORT_SHA="${TARGET_COMMIT:0:12}"
TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
TAG="${ENVIRONMENT}-local-${SERVICE}-${SHORT_SHA}-${TIMESTAMP}"
WORKTREE_DIR="${TMPDIR:-/tmp}/synapse-build-${ENVIRONMENT}-${SERVICE}-${SHORT_SHA}-${TIMESTAMP}-$$"

cleanup() {
  if git -C "${ROOT}" worktree list --porcelain | grep -Fqx "worktree ${WORKTREE_DIR}"; then
    git -C "${ROOT}" worktree remove -f "${WORKTREE_DIR}" >/dev/null 2>&1 || true
  elif [[ -d "${WORKTREE_DIR}" ]]; then
    rm -rf "${WORKTREE_DIR}"
  fi
}
trap cleanup EXIT

echo "[local-build] environment=${ENVIRONMENT}"
echo "[local-build] service=${SERVICE}"
echo "[local-build] ref=${REF}"
echo "[local-build] commit=${TARGET_COMMIT}"
echo "[local-build] project=${PROJECT_ID}"
echo "[local-build] repository=${REPOSITORY}"
echo "[local-build] worktree=${WORKTREE_DIR}"

git -C "${ROOT}" worktree add --detach "${WORKTREE_DIR}" "${TARGET_COMMIT}"

pushd "${WORKTREE_DIR}" >/dev/null
export REGION
export ARTIFACT_REGISTRY_REPOSITORY="${REPOSITORY}"
export STAGING_IMAGE_BUILD_BACKEND="${STAGING_IMAGE_BUILD_BACKEND:-local-docker}"
export DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"

bash "${WORKTREE_DIR}/scripts/deploy/gcp_cloudbuild_staging_images.sh" "${PROJECT_ID}" \
  --services "${SERVICE}" \
  --tag "${TAG}" \
  --json-output build-images.json

node "${WORKTREE_DIR}/scripts/deploy/resolve_artifact_registry_image_digests.mjs" \
  --build-images build-images.json \
  --out image-digests.json

DIGEST="$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync('image-digests.json','utf8')); console.log(data[process.argv[1]] || '')" "${SERVICE}")"
if [[ ! "${DIGEST}" =~ ^.+@sha256:[0-9a-f]{64}$ ]]; then
  echo "failed to resolve immutable digest for ${SERVICE}: ${DIGEST}" >&2
  exit 1
fi

echo "[local-build] digest=${DIGEST}"

if [[ "${ATTACH}" == "true" ]]; then
  export SERVICE DIGEST TARGET_COMMIT TAG REF ENVIRONMENT PROJECT_ID REPOSITORY
  node - <<'NODE'
  const fs = require('fs')
  const payload = {
    service_key: process.env.SERVICE,
    image_digest: process.env.DIGEST,
    source_commit_sha: process.env.TARGET_COMMIT,
    image_source: 'ephemeral_worktree_local_build',
    build_evidence: {
      tag: process.env.TAG,
      buildService: process.env.SERVICE,
      buildEnvironment: process.env.ENVIRONMENT,
      buildProject: process.env.PROJECT_ID,
      artifactRepository: process.env.REPOSITORY,
      buildHost: 'local-docker',
      worktreeMode: 'ephemeral-detached',
      sourceRef: process.env.REF,
    },
  }
  fs.writeFileSync('attach-prebuilt-image.json', `${JSON.stringify(payload, null, 2)}\n`)
NODE
  curl --fail --silent --show-error \
    -X POST "${OPS_API_BASE_URL%/}/releases/tasks/${RELEASE_TASK_ID}/attach-prebuilt-image" \
    -H "Content-Type: application/json" \
    -d @attach-prebuilt-image.json
  echo
  echo "[local-build] attached digest to release task #${RELEASE_TASK_ID}"
fi

popd >/dev/null

echo "[local-build] complete"
echo "${DIGEST}"
