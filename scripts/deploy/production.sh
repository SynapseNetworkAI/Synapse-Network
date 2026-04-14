#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_STATE_DIR="${REPO_ROOT}/.deploy"
mkdir -p "${DEPLOY_STATE_DIR}"

COMMIT_SHA="${COMMIT_SHA:-${1:-}}"
ROLLBACK_TARGET_SHA="${ROLLBACK_TARGET_SHA:-}"
TARGET_SHA="${ROLLBACK_TARGET_SHA:-${COMMIT_SHA}}"
if [[ -z "${TARGET_SHA}" ]]; then
  echo "COMMIT_SHA or ROLLBACK_TARGET_SHA is required" >&2
  exit 1
fi

pushd "${REPO_ROOT}" >/dev/null
PREVIOUS_SHA="$(git rev-parse HEAD)"
printf '%s\n' "${PREVIOUS_SHA}" > "${DEPLOY_STATE_DIR}/production.previous"
git fetch --all --prune
git checkout "${TARGET_SHA}"

if [[ -f "${REPO_ROOT}/scripts/prod/restart_prod_env.sh" ]]; then
  bash "${REPO_ROOT}/scripts/prod/restart_prod_env.sh"
elif [[ -f "${REPO_ROOT}/scripts/prod/start_prod_env.sh" ]]; then
  bash "${REPO_ROOT}/scripts/prod/start_prod_env.sh"
elif [[ -f "${REPO_ROOT}/infra/docker/staging/docker-compose.yml" ]]; then
  docker compose -f "${REPO_ROOT}/infra/docker/staging/docker-compose.yml" up -d --build
fi

if [[ -n "${PRODUCTION_HEALTHCHECK_URL:-}" ]]; then
  curl --fail --silent --show-error "${PRODUCTION_HEALTHCHECK_URL}" >/dev/null
fi

printf '%s\n' "${TARGET_SHA}" > "${DEPLOY_STATE_DIR}/production.current"
popd >/dev/null
