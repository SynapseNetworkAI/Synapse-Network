#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: $0 <label> <project-dir> <install-mode> [extra-package ...]" >&2
  exit 1
fi

LABEL="$1"
PROJECT_DIR="$2"
INSTALL_MODE="$3"
shift 3
EXTRA_PACKAGES=("$@")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/../../scripts/python/resolve_python_311.sh" ]]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
elif [[ -f "${SCRIPT_DIR}/../../../scripts/python/resolve_python_311.sh" ]]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
else
  echo "unable to locate scripts/python/resolve_python_311.sh from ${SCRIPT_DIR}" >&2
  exit 1
fi

VENV_DIR="$PROJECT_DIR/.venv"
PYTHON_BIN="$VENV_DIR/bin/python"

if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BOOTSTRAP_BIN="$(bash "$REPO_ROOT/scripts/python/resolve_python_311.sh")"
  echo "[$LABEL] creating virtual environment in $VENV_DIR"
  "$PYTHON_BOOTSTRAP_BIN" -m venv "$VENV_DIR"
fi

STAMP_FILE="$VENV_DIR/.synapse-ci-deps.sha256"

case "$INSTALL_MODE" in
  requirements)
    MANIFEST_PATH="$PROJECT_DIR/requirements.txt"
    INSTALL_CMD=("$PYTHON_BIN" -m pip install --disable-pip-version-check -r "$MANIFEST_PATH")
    ;;
  editable)
    MANIFEST_PATH="$PROJECT_DIR/pyproject.toml"
    INSTALL_CMD=("$PYTHON_BIN" -m pip install --disable-pip-version-check -e "$PROJECT_DIR")
    ;;
  *)
    echo "unknown install mode: $INSTALL_MODE" >&2
    exit 1
    ;;
esac

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "manifest not found: $MANIFEST_PATH" >&2
  exit 1
fi

EXTRA_SIGNATURE=""
if [[ ${#EXTRA_PACKAGES[@]} -gt 0 ]]; then
  EXTRA_SIGNATURE="$(printf '%s\n' "${EXTRA_PACKAGES[@]}")"
fi

DEPENDENCY_HASH="$({
  printf '%s\n' "$INSTALL_MODE"
  cat "$MANIFEST_PATH"
  printf '%s\n' "$EXTRA_SIGNATURE"
  "$PYTHON_BIN" -V
} | shasum -a 256 | awk '{print $1}')"

CURRENT_HASH=""
if [[ -f "$STAMP_FILE" ]]; then
  CURRENT_HASH="$(cat "$STAMP_FILE")"
fi

if [[ "$CURRENT_HASH" != "$DEPENDENCY_HASH" ]]; then
  echo "[$LABEL] installing Python dependencies in $PROJECT_DIR"
  "$PYTHON_BIN" -m pip install --disable-pip-version-check --upgrade pip setuptools wheel
  "${INSTALL_CMD[@]}"
  if [[ ${#EXTRA_PACKAGES[@]} -gt 0 ]]; then
    "$PYTHON_BIN" -m pip install --disable-pip-version-check "${EXTRA_PACKAGES[@]}"
  fi
  printf '%s\n' "$DEPENDENCY_HASH" > "$STAMP_FILE"
else
  echo "[$LABEL] reusing prepared virtual environment in $VENV_DIR"
fi