#!/usr/bin/env bash

[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_NAME="${1:-local}"

case "${ENV_NAME}" in
    local)
        ENV_FILE="${PROJECT_ROOT}/.env.local"
        ;;
    prod)
        ENV_FILE="${PROJECT_ROOT}/.env.prod"
        ;;
    *)
        echo "Unsupported environment: ${ENV_NAME}. Use 'local' or 'prod'." >&2
        exit 1
        ;;
esac

if [[ -f "${ENV_FILE}" ]]; then
    set -a
    source "${ENV_FILE}"
    set +a
fi

PORT="${SERVICE_PORT:-8100}"
PID_FILE="${PROJECT_ROOT}/run/provider_service.${ENV_NAME}.pid"

echo "=== Stopping Provider Service (${ENV_NAME}) ==="
echo "Tip: prefer ./scripts/stop.${ENV_NAME}.sh for explicit environment shutdown."

PID=""

if [[ -f "${PID_FILE}" ]]; then
    PID="$(cat "${PID_FILE}" 2>/dev/null || true)"
fi

if [[ -z "$PID" ]]; then
    PID=$(lsof -t -nP -iTCP:$PORT -sTCP:LISTEN | head -n 1 || true)
fi

if [[ -n "$PID" ]]; then
    echo "Killing Provider process (PID: $PID) listening on port $PORT..."
    kill "$PID" || true
    sleep 1
    
    # Force kill if still lingering
    if kill -0 "$PID" 2>/dev/null; then
        echo "Force killing $PID..."
        kill -9 "$PID" || true
    fi
    rm -f "$PID_FILE"
    echo "✅ Provider Service stopped."
else
    echo "No process is currently listening on port $PORT."
    rm -f "$PID_FILE"
fi