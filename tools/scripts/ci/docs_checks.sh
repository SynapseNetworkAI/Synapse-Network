#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

echo "[ci:docs] validating documentation constraints"

node "$ROOT_DIR/tools/scripts/validate_docs.js"