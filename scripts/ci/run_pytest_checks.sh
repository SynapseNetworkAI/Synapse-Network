#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: $0 <label> <project-dir> [test-target]" >&2
  exit 1
fi

LABEL="$1"
PROJECT_DIR="$2"
TEST_TARGET="${3:-tests}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$PROJECT_DIR/pyproject.toml" ]]; then
  INSTALL_MODE="editable"
else
  INSTALL_MODE="requirements"
fi

bash "$SCRIPT_DIR/ensure_python_env.sh" "$LABEL" "$PROJECT_DIR" "$INSTALL_MODE" pytest

PYTHON_BIN="$PROJECT_DIR/.venv/bin/python"

echo "[$LABEL] running pytest in $PROJECT_DIR with $PYTHON_BIN"
cd "$PROJECT_DIR"

"$PYTHON_BIN" -m pytest -q "$TEST_TARGET"
