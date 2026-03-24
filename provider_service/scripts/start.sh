#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENV_DIR="${PROJECT_ROOT}/.venv"
PYTHON_BIN="${VENV_DIR}/bin/python"
PIP_BIN="${VENV_DIR}/bin/pip"
LOG_DIR="${PROJECT_ROOT}/logs"
RUN_DIR="${PROJECT_ROOT}/run"
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
        echo "Recommended entrypoints: ./scripts/start.local.sh or ./scripts/start.prod.sh" >&2
        exit 1
        ;;
esac

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Environment file not found: ${ENV_FILE}" >&2
    exit 1
fi

set -a
source "${ENV_FILE}"
set +a

PORT="${SERVICE_PORT:-8100}"
PID_FILE="${RUN_DIR}/provider_service.${ENV_NAME}.pid"
LOG_FILE="${LOG_DIR}/provider_service.${ENV_NAME}.log"
REPOSITORY_BACKEND="${SENTIMENT_REPOSITORY_BACKEND:-file}"
SCHEDULER_ENABLED="${SENTIMENT_SCHEDULER_ENABLED:-false}"
SCHEDULER_INTERVAL_S="${SENTIMENT_SCHEDULER_INTERVAL_S:-30}"
SIGNATURE_ENABLED="${GATEWAY_PROVIDER_SIGNATURE_ENABLED:-true}"
PROXY_POOL_ENABLED="${SENTIMENT_PROXY_POOL_ENABLED:-false}"
PROXY_POOL_URLS_JSON="${SENTIMENT_PROXY_POOL_URLS_JSON:-}"
PROXY_POOL_URLS_NORMALIZED="$(printf '%s' "${PROXY_POOL_URLS_JSON}" | tr -d '[:space:]')"
ALLOW_INSECURE_PROD_START="${ALLOW_INSECURE_PROD_START:-false}"
POSTGRES_DSN_VALUE="${SENTIMENT_POSTGRES_DSN:-}"
SIGNATURE_ENABLED_NORMALIZED="$(printf '%s' "${SIGNATURE_ENABLED}" | tr '[:upper:]' '[:lower:]')"
PROXY_POOL_ENABLED_NORMALIZED="$(printf '%s' "${PROXY_POOL_ENABLED}" | tr '[:upper:]' '[:lower:]')"
ALLOW_INSECURE_PROD_START_NORMALIZED="$(printf '%s' "${ALLOW_INSECURE_PROD_START}" | tr '[:upper:]' '[:lower:]')"

if [[ -n "${POSTGRES_DSN_VALUE}" ]]; then
    DATABASE_TARGET="${POSTGRES_DSN_VALUE}"
else
    DATABASE_TARGET="(none)"
fi

echo "=== Starting Provider Service (${ENV_NAME}) ==="
echo "Tip: prefer ./scripts/start.${ENV_NAME}.sh for explicit environment startup."
echo "Config summary: backend=${REPOSITORY_BACKEND} | scheduler_enabled=${SCHEDULER_ENABLED} | scheduler_interval_s=${SCHEDULER_INTERVAL_S} | signature_enabled=${SIGNATURE_ENABLED} | proxy_pool_enabled=${PROXY_POOL_ENABLED} | env_file=${ENV_FILE} | database=${DATABASE_TARGET}"

if [[ "${PROXY_POOL_ENABLED_NORMALIZED}" == "true" && ( -z "${PROXY_POOL_URLS_NORMALIZED}" || "${PROXY_POOL_URLS_NORMALIZED}" == "[]" ) ]]; then
    echo "CONFIG ERROR: SENTIMENT_PROXY_POOL_ENABLED=true but SENTIMENT_PROXY_POOL_URLS_JSON is empty." >&2
    exit 1
fi

if [[ "${ENV_NAME}" == "prod" && "${SIGNATURE_ENABLED_NORMALIZED}" != "true" ]]; then
    if [[ "${ALLOW_INSECURE_PROD_START_NORMALIZED}" != "true" ]]; then
        echo $'\033[31;1mSECURITY BLOCK: refusing to start prod with GATEWAY_PROVIDER_SIGNATURE_ENABLED=false. Set ALLOW_INSECURE_PROD_START=true only for an intentional emergency override. This usually means a local debug config leaked into prod.\033[0m' >&2
        exit 1
    fi
    echo $'\033[31;1mSECURITY WARNING: prod is starting with GATEWAY_PROVIDER_SIGNATURE_ENABLED=false under ALLOW_INSECURE_PROD_START=true. Gateway request signature verification is disabled. This is unsafe for production and should be temporary only.\033[0m' >&2
fi

mkdir -p "${LOG_DIR}" "${RUN_DIR}"

if lsof -t -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $PORT is already in use. Stopping existing process..."
    bash "$SCRIPT_DIR/stop.sh" "${ENV_NAME}"
fi

if [[ ! -d "$VENV_DIR" ]]; then
    echo "Virtual environment not found at $VENV_DIR."
    echo "Please ensure the .venv exists in the project root."
    exit 1
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
    echo "Python executable not found: ${PYTHON_BIN}" >&2
    exit 1
fi

echo "Ensuring requirements are installed..."
"$PIP_BIN" install -r "$PROJECT_ROOT/requirements.txt" >/dev/null 2>&1 || true

echo "Starting uvicorn server on port $PORT..."
cd "$PROJECT_ROOT"

nohup "$PYTHON_BIN" -m uvicorn app.main:app --host "${SERVICE_HOST:-0.0.0.0}" --port "$PORT" > "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"

sleep 2

if kill -0 "$PID" >/dev/null 2>&1; then
    echo "✅ Provider Service started successfully! (PID: $PID)"
    echo "Environment: ${ENV_NAME}"
    echo "Env file: ${ENV_FILE}"
    echo "Logs: $LOG_FILE"
else
    echo "❌ Failed to start Provider Service. Check logs:"
    cat "$LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
fi