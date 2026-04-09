#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <label> <project-dir>" >&2
  exit 1
fi

LABEL="$1"
PROJECT_DIR="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "$PROJECT_DIR/pyproject.toml" ]]; then
  echo "python build checks require pyproject.toml: $PROJECT_DIR" >&2
  exit 1
fi

bash "$SCRIPT_DIR/ensure_python_env.sh" "$LABEL" "$PROJECT_DIR" editable build

PYTHON_BIN="$PROJECT_DIR/.venv/bin/python"

echo "[$LABEL] running python packaging build in $PROJECT_DIR with $PYTHON_BIN"
cd "$PROJECT_DIR"

rm -rf dist build
find "$PROJECT_DIR" -maxdepth 1 -name "*.egg-info" -type d -exec rm -rf {} +

"$PYTHON_BIN" -m build