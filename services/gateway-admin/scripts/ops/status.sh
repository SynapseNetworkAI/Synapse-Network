#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PID="$(find_running_pid)"
PORT="${ADMIN_GATEWAY_PORT:-8300}"

if [[ -z "${PID}" ]]; then
  echo "gateway-admin status: stopped"
  echo "Expected port : ${PORT}"
  echo "Log file      : ${LOG_FILE}"
  echo "PID file      : ${PID_FILE}"
  exit 0
fi

echo "gateway-admin status: running"
echo "PID           : ${PID}"
echo "Port          : ${PORT}"
echo "Health        : http://127.0.0.1:${PORT}/health"
echo "Log file      : ${LOG_FILE}"
echo "PID file      : ${PID_FILE}"
