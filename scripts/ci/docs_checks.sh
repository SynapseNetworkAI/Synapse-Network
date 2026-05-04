#!/usr/bin/env bash

set -euo pipefail

# Resolve repository root even when scripts/ is executed via the historical
# tools/scripts/ symlink path or from a git worktree where .git is a file.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(env -u GIT_DIR -u GIT_WORK_TREE git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT_DIR" ]; then
  ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
  while [ ! -d "$ROOT_DIR/.git" ] && [ ! -f "$ROOT_DIR/.git" ]; do
    NEXT_ROOT="$(cd "$ROOT_DIR/.." && pwd -P)"
    if [ "$NEXT_ROOT" = "$ROOT_DIR" ]; then
      echo "[ci:docs] unable to locate repository root from $SCRIPT_DIR" >&2
      exit 1
    fi
    ROOT_DIR="$NEXT_ROOT"
  done
fi

echo "[ci:docs] validating documentation constraints"

node "$ROOT_DIR/scripts/ci/validate_docs.js"
node "$ROOT_DIR/scripts/ci/seo_public_assets_check.mjs"
node "$ROOT_DIR/scripts/ci/legacy_gateway_generate_check.mjs"

echo "[ci:docs] checking public SDK docs stay staging-first"
if grep -RInE \
  '(costUsdc: Number|Number\([^)]*(price|cost)|cost_usdc=float|float\([^)]*(price|cost|service\.price_usdc)|SYNAPSE_API_KEY|does not wrap provider withdrawals|还没封装 provider withdrawal)' \
  "$ROOT_DIR/services/docs-front/content/docs/sdks" \
  "$ROOT_DIR/services/docs-front/content/docs/get-started" \
  "$ROOT_DIR/services/docs-front/content/docs/mcp.mdx"; then
  echo "[ci:docs] public SDK docs drifted from staging-first typed SDK contract" >&2
  exit 1
fi
