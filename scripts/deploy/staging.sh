#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_STATE_DIR="${REPO_ROOT}/.deploy"
mkdir -p "${DEPLOY_STATE_DIR}"

COMMIT_SHA="${COMMIT_SHA:-${1:-}}"
if [[ -z "${COMMIT_SHA}" ]]; then
  echo "COMMIT_SHA is required" >&2
  exit 1
fi

pushd "${REPO_ROOT}" >/dev/null
PREVIOUS_SHA="$(git rev-parse HEAD)"
printf '%s\n' "${PREVIOUS_SHA}" > "${DEPLOY_STATE_DIR}/staging.previous"
git fetch --all --prune
git checkout "${COMMIT_SHA}"

if [[ -f "${REPO_ROOT}/scripts/staging/start_infra.sh" ]]; then
  bash "${REPO_ROOT}/scripts/staging/start_infra.sh"
fi
if [[ -f "${REPO_ROOT}/scripts/staging/restart_staging_env.sh" ]]; then
  bash "${REPO_ROOT}/scripts/staging/restart_staging_env.sh"
elif [[ -f "${REPO_ROOT}/infra/docker/staging/docker-compose.yml" ]]; then
  docker compose -f "${REPO_ROOT}/infra/docker/staging/docker-compose.yml" up -d --build
fi

if [[ -n "${STAGING_HEALTHCHECK_URL:-}" ]]; then
  curl --fail --silent --show-error "${STAGING_HEALTHCHECK_URL}" >/dev/null
fi

printf '%s\n' "${COMMIT_SHA}" > "${DEPLOY_STATE_DIR}/staging.current"
popd >/dev/null
