#!/usr/bin/env bash

set -euo pipefail

PORT=8100
echo "=== Stopping Provider Service ==="

# Find PID running on the target port
PID=$(lsof -t -nP -iTCP:$PORT -sTCP:LISTEN | head -n 1 || true)

if [[ -n "$PID" ]]; then
    echo "Killing Provider process (PID: $PID) listening on port $PORT..."
    kill "$PID" || true
    sleep 1
    
    # Force kill if still lingering
    if kill -0 "$PID" 2>/dev/null; then
        echo "Force killing $PID..."
        kill -9 "$PID" || true
    fi
    echo "✅ Provider Service stopped."
else
    echo "No process is currently listening on port $PORT."
fi