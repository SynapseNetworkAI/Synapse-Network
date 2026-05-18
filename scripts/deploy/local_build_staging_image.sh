#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
exec bash "${ROOT}/scripts/deploy/local_build_frontend_image.sh" --environment staging "$@"
