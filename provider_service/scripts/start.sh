#!/usr/bin/env bash

[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENV_DIR="${PROJECT_ROOT}/.venv"
PYTHON_BIN="${VENV_DIR}/bin/python"
PIP_BIN="${VENV_DIR}/bin/pip"
LOG_DIR="${PROJECT_ROOT}/logs"
RUN_DIR="${PROJECT_ROOT}/run"
ENV_NAME="${1:-local}"
STARTUP_TIMEOUT_SEC="${STARTUP_TIMEOUT_SEC:-20}"

case "${ENV_NAME}" in
    local)
        ENV_FILE="${PROJECT_ROOT}/.env.local"
        ;;
    staging)
        ENV_FILE="${PROJECT_ROOT}/.env.staging"
        ;;
    prod)
        ENV_FILE="${PROJECT_ROOT}/.env.prod"
        ;;
    *)
        echo "Unsupported environment: ${ENV_NAME}. Use 'local', 'staging', or 'prod'." >&2
        echo "Recommended entrypoints: ./scripts/start.local.sh / ./scripts/start.staging.sh / ./scripts/start.prod.sh" >&2
        exit 1
        ;;
esac

wait_for_health() {
    local health_url="$1"
    local timeout_sec="$2"
    local elapsed=0

    while [[ "$elapsed" -lt "$timeout_sec" ]]; do
        if curl -fsS "$health_url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    return 1
}

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
SENTIMENT_REPOSITORY_BACKEND="${SENTIMENT_REPOSITORY_BACKEND:-file}"
SCHEDULER_ENABLED="${SENTIMENT_SCHEDULER_ENABLED:-false}"
SCHEDULER_INTERVAL_S="${SENTIMENT_SCHEDULER_INTERVAL_S:-30}"
SIGNATURE_ENABLED="${GATEWAY_PROVIDER_SIGNATURE_ENABLED:-true}"
PROXY_POOL_ENABLED="${SENTIMENT_PROXY_POOL_ENABLED:-false}"
PROXY_POOL_URLS_JSON="${SENTIMENT_PROXY_POOL_URLS_JSON:-}"
PROXY_POOL_URLS_NORMALIZED="$(printf '%s' "${PROXY_POOL_URLS_JSON}" | tr -d '[:space:]')"
ALLOW_INSECURE_PROD_START="${ALLOW_INSECURE_PROD_START:-false}"
POSTGRES_DSN_VALUE="${PROVIDER_SERVICE_POSTGRES_DSN:-}"
SERVICE_HOST_VALUE="${SERVICE_HOST:-0.0.0.0}"
SIGNATURE_ENABLED_NORMALIZED="$(printf '%s' "${SIGNATURE_ENABLED}" | tr '[:upper:]' '[:lower:]')"
PROXY_POOL_ENABLED_NORMALIZED="$(printf '%s' "${PROXY_POOL_ENABLED}" | tr '[:upper:]' '[:lower:]')"
ALLOW_INSECURE_PROD_START_NORMALIZED="$(printf '%s' "${ALLOW_INSECURE_PROD_START}" | tr '[:upper:]' '[:lower:]')"

case "${SERVICE_HOST_VALUE}" in
    0.0.0.0|::)
        HEALTH_HOST="127.0.0.1"
        ;;
    *)
        HEALTH_HOST="${SERVICE_HOST_VALUE}"
        ;;
esac

HEALTH_URL="http://${HEALTH_HOST}:${PORT}/health"

if [[ -n "${POSTGRES_DSN_VALUE}" ]]; then
    DATABASE_TARGET="${POSTGRES_DSN_VALUE}"
else
    DATABASE_TARGET="(none)"
fi

echo "=== Starting Provider Service (${ENV_NAME}) ==="
echo "Tip: prefer ./scripts/start.${ENV_NAME}.sh for explicit environment startup."
echo "Config summary: sentiment_backend=${SENTIMENT_REPOSITORY_BACKEND} | protocol_brief_backend=postgres | scheduler_enabled=${SCHEDULER_ENABLED} | scheduler_interval_s=${SCHEDULER_INTERVAL_S} | signature_enabled=${SIGNATURE_ENABLED} | proxy_pool_enabled=${PROXY_POOL_ENABLED} | env_file=${ENV_FILE} | database=${DATABASE_TARGET}"

if [[ "${PROXY_POOL_ENABLED_NORMALIZED}" == "true" && ( -z "${PROXY_POOL_URLS_NORMALIZED}" || "${PROXY_POOL_URLS_NORMALIZED}" == "[]" ) ]]; then
    echo "CONFIG ERROR: SENTIMENT_PROXY_POOL_ENABLED=true but SENTIMENT_PROXY_POOL_URLS_JSON is empty." >&2
    exit 1
fi

if [[ ( "${ENV_NAME}" == "staging" || "${ENV_NAME}" == "prod" ) && "${SIGNATURE_ENABLED_NORMALIZED}" != "true" ]]; then
    if [[ "${ALLOW_INSECURE_PROD_START_NORMALIZED}" != "true" ]]; then
        echo $'\033[31;1mSECURITY BLOCK: refusing to start staging/prod with GATEWAY_PROVIDER_SIGNATURE_ENABLED=false. Set ALLOW_INSECURE_PROD_START=true only for an intentional emergency override. This usually means a local debug config leaked into a shared environment.\033[0m' >&2
        exit 1
    fi
    echo $'\033[31;1mSECURITY WARNING: staging/prod is starting with GATEWAY_PROVIDER_SIGNATURE_ENABLED=false under ALLOW_INSECURE_PROD_START=true. Gateway request signature verification is disabled. This is unsafe for any shared environment and should be temporary only.\033[0m' >&2
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

nohup setsid "$PYTHON_BIN" -m uvicorn app.main:app --host "${SERVICE_HOST_VALUE}" --port "$PORT" > "$LOG_FILE" 2>&1 < /dev/null &
PID=$!
if wait_for_health "$HEALTH_URL" "$STARTUP_TIMEOUT_SEC"; then
    echo "$PID" > "$PID_FILE"
    echo "✅ Provider Service started successfully! (PID: $PID)"
    echo "Environment: ${ENV_NAME}"
    echo "Env file: ${ENV_FILE}"
    echo "Logs: $LOG_FILE"
    echo "Health: ${HEALTH_URL}"
else
    echo "❌ Failed to start Provider Service. Health check did not pass within ${STARTUP_TIMEOUT_SEC}s. Check logs:"
    if kill -0 "$PID" >/dev/null 2>&1; then
        kill "$PID" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$PID" >/dev/null 2>&1; then
            kill -9 "$PID" >/dev/null 2>&1 || true
        fi
    fi
    rm -f "$PID_FILE"
    tail -n 80 "$LOG_FILE" || true
    exit 1
fi
