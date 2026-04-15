#!/usr/bin/env bash

set -euo pipefail

# Resolve repository root even when scripts/ is executed via the historical
# tools/scripts/ symlink path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

while [ ! -d "$ROOT_DIR/.git" ]; do
  NEXT_ROOT="$(cd "$ROOT_DIR/.." && pwd -P)"
  if [ "$NEXT_ROOT" = "$ROOT_DIR" ]; then
    echo "[ci:docs] unable to locate repository root from $SCRIPT_DIR" >&2
    exit 1
  fi
  ROOT_DIR="$NEXT_ROOT"
done

echo "[ci:docs] validating documentation constraints"

node "$ROOT_DIR/scripts/ci/validate_docs.js"
