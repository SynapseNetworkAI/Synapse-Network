#!/usr/bin/env bash

# Helper script to boot both microservices simultaneously
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR" || exit 1

source venv/bin/activate
export PYTHONPATH=$PYTHONPATH:$(pwd)

echo "Starting Client API on port 8000..."
uvicorn indexer.c_api.main:app --host 0.0.0.0 --port 8000 &
CLIENT_PID=$!

echo "Starting Admin API on port 8001..."
uvicorn indexer.admin_api.main:app --host 0.0.0.0 --port 8001 &
ADMIN_PID=$!

echo "Both services are running. Press Ctrl+C to stop."

trap "kill $CLIENT_PID $ADMIN_PID" SIGINT

wait $CLIENT_PID $ADMIN_PID
