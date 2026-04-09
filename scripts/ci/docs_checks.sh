#!/usr/bin/env bash

set -euo pipefail

# scripts/ is a symlink (→ tools/scripts); logical path gives scripts/ci as parent
# so repo root is two levels up, not three.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[ci:docs] validating documentation constraints"

node "$ROOT_DIR/tools/scripts/ci/validate_docs.js"