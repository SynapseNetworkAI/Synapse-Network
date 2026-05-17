#!/usr/bin/env bash
set -euo pipefail

SERVICE=""
SOURCE_REF="main"
RELEASE_TASK_ID=""
OPS_CONSOLE_URL="${OPS_CONSOLE_URL:-http://localhost:9700}"
PROJECT_ID="${STAGING_GCP_PROJECT_ID:-fabled-archive-494108-k5}"
REGION="${STAGING_GCP_REGION:-us-central1}"
REPOSITORY="${STAGING_ARTIFACT_REGISTRY_REPOSITORY:-synapse-staging}"
JSON_OUTPUT=""
ATTACH="auto"

usage() {
  cat <<'USAGE'
Usage:
  scripts/deploy/local_build_staging_image.sh --service admin-front --ref main --release-task-id 123

Options:
  --service <admin-front|user-front|docs-front>
                                      Frontend service to build.
  --ref <branch|tag|sha>                 Git ref to build from. Default: main.
  --release-task-id <id>                 Attach the immutable digest to this Ops Console release task.
  --ops-console-url <url>                Ops Console URL. Default: http://localhost:9700.
  --json-output <path>                   Write build evidence JSON to this path.
  --no-attach                           Build and print evidence without calling Ops Console.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service)
      SERVICE="${2:-}"
      shift 2
      ;;
    --ref)
      SOURCE_REF="${2:-}"
      shift 2
      ;;
    --release-task-id)
      RELEASE_TASK_ID="${2:-}"
      shift 2
      ;;
    --ops-console-url)
      OPS_CONSOLE_URL="${2:-}"
      shift 2
      ;;
    --json-output)
      JSON_OUTPUT="${2:-}"
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
      usage >&2
      exit 2
      ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_cmd git
require_cmd gcloud
require_cmd docker
require_cmd node

case "${SERVICE}" in
  admin-front|user-front|docs-front)
    ;;
  *)
    echo "--service must be admin-front, user-front, or docs-front" >&2
    exit 2
    ;;
esac

if [[ "${ATTACH}" == "auto" && -z "${RELEASE_TASK_ID}" ]]; then
  ATTACH="false"
fi
if [[ "${ATTACH}" != "false" ]]; then
  require_cmd curl
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
TARGET_COMMIT="$(git rev-parse "${SOURCE_REF}^{commit}")"
SHORT_SHA="$(git rev-parse --short=12 "${TARGET_COMMIT}")"
TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
TAG="staging-local-${SERVICE}-${SHORT_SHA}-${TIMESTAMP}"
WORKTREE_DIR="/tmp/synapse-build-${SERVICE}-${SHORT_SHA}-${TIMESTAMP}-$$"

cleanup() {
  local status=$?
  if [[ -d "${WORKTREE_DIR}" ]]; then
    echo "[local-build] cleaning worktree ${WORKTREE_DIR}"
    git -C "${REPO_ROOT}" worktree remove -f "${WORKTREE_DIR}" >/dev/null 2>&1 || rm -rf "${WORKTREE_DIR}"
  fi
  exit "${status}"
}
trap cleanup EXIT

echo "[local-build] service=${SERVICE}"
echo "[local-build] source_ref=${SOURCE_REF}"
echo "[local-build] target_commit=${TARGET_COMMIT}"
echo "[local-build] creating detached worktree ${WORKTREE_DIR}"
git -C "${REPO_ROOT}" worktree add --detach "${WORKTREE_DIR}" "${TARGET_COMMIT}"

pushd "${WORKTREE_DIR}" >/dev/null
export REGION
export ARTIFACT_REGISTRY_REPOSITORY="${REPOSITORY}"
export STAGING_IMAGE_BUILD_BACKEND=local-docker
export DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"

echo "[local-build] building and pushing ${SERVICE}:${TAG}"
bash scripts/deploy/gcp_cloudbuild_staging_images.sh "${PROJECT_ID}" \
  --services "${SERVICE}" \
  --tag "${TAG}" \
  --json-output build-images.json

echo "[local-build] resolving immutable digest from Artifact Registry"
node scripts/deploy/resolve_artifact_registry_image_digests.mjs \
  --build-images build-images.json \
  --out image-digests.json

IMAGE_DIGEST="$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync('image-digests.json','utf8')); process.stdout.write(d['${SERVICE}'] || '')")"
if [[ ! "${IMAGE_DIGEST}" =~ @sha256:[0-9a-f]{64}$ ]]; then
  echo "digest resolution failed; got ${IMAGE_DIGEST:-<empty>}" >&2
  exit 1
fi

EVIDENCE_PATH="${JSON_OUTPUT:-/tmp/synapse-${SERVICE}-prebuilt-${SHORT_SHA}.json}"
node - <<NODE
const fs = require('fs')
const payload = {
  service_key: '${SERVICE}',
  image_digest: '${IMAGE_DIGEST}',
  source_commit_sha: '${TARGET_COMMIT}',
  image_source: 'ephemeral_worktree_local_build',
  build_evidence: {
    tag: '${TAG}',
    source_ref: '${SOURCE_REF}',
    source_commit_sha: '${TARGET_COMMIT}',
    docker_platform: process.env.DOCKER_PLATFORM || 'linux/amd64',
    project_id: '${PROJECT_ID}',
    region: '${REGION}',
    repository: '${REPOSITORY}',
    built_at: new Date().toISOString()
  }
}
fs.writeFileSync('${EVIDENCE_PATH}', JSON.stringify(payload, null, 2) + '\\n')
NODE

echo "[local-build] immutable image: ${IMAGE_DIGEST}"
echo "[local-build] evidence: ${EVIDENCE_PATH}"

if [[ "${ATTACH}" != "false" ]]; then
  echo "[local-build] attaching image to release task #${RELEASE_TASK_ID}"
  curl --fail --silent --show-error \
    -X POST "${OPS_CONSOLE_URL%/}/api/releases/tasks/${RELEASE_TASK_ID}/attach-prebuilt-image" \
    -H "Content-Type: application/json" \
    -d @"${EVIDENCE_PATH}"
  echo
fi
popd >/dev/null
