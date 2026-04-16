#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
HOOKS_DIR="$ROOT_DIR/.githooks"
PRE_PUSH_HOOK="$HOOKS_DIR/pre-push"

if [[ ! -d "$ROOT_DIR/.git" ]]; then
  echo "[hooks] repository root not found from $SCRIPT_DIR" >&2
  exit 1
fi

if [[ ! -f "$PRE_PUSH_HOOK" ]]; then
  echo "[hooks] missing hook file: $PRE_PUSH_HOOK" >&2
  exit 1
fi

chmod +x "$PRE_PUSH_HOOK"
git -C "$ROOT_DIR" config core.hooksPath .githooks

echo "[hooks] installed repository hooks"
echo "[hooks] core.hooksPath=$(git -C "$ROOT_DIR" config --get core.hooksPath)"
echo "[hooks] pre-push will now run: bash scripts/ci/pr_checks.sh"
echo "[hooks] emergency bypass remains available via: git push --no-verify"
