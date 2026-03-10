#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
PORT=8100

echo "=== Starting Provider Service ==="

# 1. Check if already running
if lsof -t -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $PORT is already in use. Stopping existing process..."
    bash "$SCRIPT_DIR/stop.sh"
fi

# 2. Setup Virtual Environment
if [[ ! -d "$VENV_DIR" ]]; then
    echo "Virtual environment not found at $VENV_DIR."
    echo "Please ensure the .venv exists in the project root."
    exit 1
fi

source "$VENV_DIR/bin/activate"

# 3. Install requirements (optional but ensures state is correct)
echo "Ensuring requirements are installed..."
pip install -r "$SCRIPT_DIR/requirements.txt" >/dev/null 2>&1 || true

# 4. Start the service
echo "Starting uvicorn server on port $PORT..."
cd "$SCRIPT_DIR"

# Note: We intentionally avoid `--reload` here because it uses multiprocess spawning 
# which can conflict with Python 3.14's strict multiprocessing bootstrap contexts.
nohup python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT > "$SCRIPT_DIR/provider.log" 2>&1 &
PID=$!

sleep 2

if kill -0 "$PID" >/dev/null 2>&1; then
    echo "✅ Provider Service started successfully! (PID: $PID)"
    echo "Logs: $SCRIPT_DIR/provider.log"
else
    echo "❌ Failed to start Provider Service. Check logs:"
    cat "$SCRIPT_DIR/provider.log"
    exit 1
fi