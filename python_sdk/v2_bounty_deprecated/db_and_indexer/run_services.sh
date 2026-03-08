#!/usr/bin/env bash

# Helper script to boot both microservices simultaneously
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR" || exit 1

# Kill any existing uvicorn processes running on these ports
echo "Checking for existing processes on ports 8000 and 8001..."
lsof -ti :8000,8001 | xargs kill -9 2>/dev/null || true

source venv/bin/activate
export PYTHONPATH=$PYTHONPATH:$(pwd)

echo "Starting Client API on port 8000..."
uvicorn indexer.c_api.main:app --host 0.0.0.0 --port 8000 &
CLIENT_PID=$!

echo "Starting Admin API on port 8001..."
uvicorn indexer.admin_api.main:app --host 0.0.0.0 --port 8001 &
ADMIN_PID=$!

echo "Both services are running. Press Ctrl+C to stop."

trap "echo 'Shutting down services...'; kill -9 $CLIENT_PID $ADMIN_PID 2>/dev/null; exit" SIGINT SIGTERM

wait $CLIENT_PID $ADMIN_PID
