#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_DIR="${ROOT_DIR}/infra/docker/staging"
ENV_FILE="${COMPOSE_DIR}/.env"

if [[ ! -d "${COMPOSE_DIR}" ]]; then
  echo "Staging compose directory missing: ${COMPOSE_DIR}" >&2
  exit 1
fi

cd "${COMPOSE_DIR}"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy .env.example and replace every secret before managing staging infra." >&2
  exit 1
fi

echo "[staging-infra] Stopping shared services"
docker compose --env-file .env down "$@"
