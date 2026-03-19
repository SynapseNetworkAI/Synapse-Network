#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <label> <project-dir>" >&2
  exit 1
fi

LABEL="$1"
PROJECT_DIR="$2"

if [[ -x "$PROJECT_DIR/.venv/bin/python" ]]; then
  PYTHON_BIN="$PROJECT_DIR/.venv/bin/python"
elif [[ -x "$PROJECT_DIR/venv/bin/python" ]]; then
  PYTHON_BIN="$PROJECT_DIR/venv/bin/python"
else
  PYTHON_BIN="python3"
fi

TOOLS_DIR="$PROJECT_DIR/.ci-tools"
mkdir -p "$TOOLS_DIR"

if ! PYTHONPATH="$TOOLS_DIR${PYTHONPATH:+:$PYTHONPATH}" "$PYTHON_BIN" -c "import build" >/dev/null 2>&1; then
  "$PYTHON_BIN" -m pip install --disable-pip-version-check --quiet --target "$TOOLS_DIR" build
fi

echo "[$LABEL] running python packaging build in $PROJECT_DIR with $PYTHON_BIN"
cd "$PROJECT_DIR"

rm -rf dist build
find "$PROJECT_DIR" -maxdepth 1 -name "*.egg-info" -type d -exec rm -rf {} +

PYTHONPATH="$TOOLS_DIR${PYTHONPATH:+:$PYTHONPATH}" "$PYTHON_BIN" -m build