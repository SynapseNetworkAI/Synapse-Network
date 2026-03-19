#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: $0 <label> <project-dir> [test-target]" >&2
  exit 1
fi

LABEL="$1"
PROJECT_DIR="$2"
TEST_TARGET="${3:-tests}"

if [[ -x "$PROJECT_DIR/.venv/bin/python" ]]; then
  PYTHON_BIN="$PROJECT_DIR/.venv/bin/python"
elif [[ -x "$PROJECT_DIR/venv/bin/python" ]]; then
  PYTHON_BIN="$PROJECT_DIR/venv/bin/python"
else
  PYTHON_BIN="python3"
fi

echo "[$LABEL] running pytest in $PROJECT_DIR with $PYTHON_BIN"
cd "$PROJECT_DIR"

"$PYTHON_BIN" -m pytest -q "$TEST_TARGET"
