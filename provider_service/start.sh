#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"
PYTHON_BIN="${VENV_DIR}/bin/python"
PIP_BIN="${VENV_DIR}/bin/pip"
LOG_DIR="${SCRIPT_DIR}/logs"
RUN_DIR="${SCRIPT_DIR}/run"
ENV_NAME="${1:-local}"

case "${ENV_NAME}" in
    local)
        ENV_FILE="${SCRIPT_DIR}/.env.local"
        ;;
    prod)
        ENV_FILE="${SCRIPT_DIR}/.env.prod"
        ;;
    *)
        echo "Unsupported environment: ${ENV_NAME}. Use 'local' or 'prod'." >&2
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

echo "=== Starting Provider Service (${ENV_NAME}) ==="

mkdir -p "${LOG_DIR}" "${RUN_DIR}"

# 1. Check if already running
if lsof -t -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $PORT is already in use. Stopping existing process..."
    bash "$SCRIPT_DIR/stop.sh" "${ENV_NAME}"
fi

# 2. Setup Virtual Environment
if [[ ! -d "$VENV_DIR" ]]; then
    echo "Virtual environment not found at $VENV_DIR."
    echo "Please ensure the .venv exists in the project root."
    exit 1
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
    echo "Python executable not found: ${PYTHON_BIN}" >&2
    exit 1
fi

# 3. Install requirements (optional but ensures state is correct)
echo "Ensuring requirements are installed..."
"$PIP_BIN" install -r "$SCRIPT_DIR/requirements.txt" >/dev/null 2>&1 || true

# 4. Start the service
echo "Starting uvicorn server on port $PORT..."
cd "$SCRIPT_DIR"

# Note: We intentionally avoid `--reload` here because it uses multiprocess spawning 
# which can conflict with Python 3.14's strict multiprocessing bootstrap contexts.
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