#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker/local/docker-compose.yml"
LOCAL_GATEWAY_POSTGRES_PORT="${SYNAPSE_POSTGRES_HOST_PORT:-15432}"

if [[ "${LOCAL_GATEWAY_RESET_CONFIRM:-}" != "I_UNDERSTAND_LOCAL_DATA_LOSS" ]]; then
  cat >&2 <<'EOF'
Refusing to reset local Gateway Docker data.
Set LOCAL_GATEWAY_RESET_CONFIRM=I_UNDERSTAND_LOCAL_DATA_LOSS to delete local Docker volumes.
This is local-only and will remove local Gateway Postgres, Redis, and MinIO data.
EOF
  exit 2
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "Error: neither 'docker compose' nor 'docker-compose' is available." >&2
  exit 1
fi

cd "${ROOT_DIR}"

echo "Resetting local Gateway Docker data with docker compose down -v..."
"${COMPOSE_CMD[@]}" -f "${COMPOSE_FILE}" down -v

echo "Starting fresh local Gateway Docker dependencies on Postgres port ${LOCAL_GATEWAY_POSTGRES_PORT}..."
SYNAPSE_POSTGRES_HOST_PORT="${LOCAL_GATEWAY_POSTGRES_PORT}" \
  "${COMPOSE_CMD[@]}" -f "${COMPOSE_FILE}" up -d postgres redis minio

echo "Local Gateway Docker data reset complete."
