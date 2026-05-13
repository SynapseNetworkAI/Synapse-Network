#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${REPO_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR missing required command: $1" >&2
    exit 1
  fi
}

require_command gh
require_command gcloud
require_command bq
require_command jq
require_command node

cd "${ROOT_DIR}"

exec node "${ROOT_DIR}/scripts/ops/gcp_billing_review.mjs" "$@"
