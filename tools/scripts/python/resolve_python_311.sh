#!/usr/bin/env bash

set -euo pipefail

REQUIRED_MINOR="3.11"

version_of() {
  local python_bin="$1"
  "$python_bin" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null
}

emit_if_matching() {
  local candidate="$1"
  local resolved=""
  local version=""

  if [[ -z "$candidate" ]]; then
    return 1
  fi

  if [[ "$candidate" == */* ]]; then
    if [[ ! -x "$candidate" ]]; then
      return 1
    fi
    resolved="$candidate"
  else
    if ! resolved="$(command -v "$candidate" 2>/dev/null)"; then
      return 1
    fi
  fi

  version="$(version_of "$resolved")"
  if [[ "$version" == "$REQUIRED_MINOR" ]]; then
    printf '%s\n' "$resolved"
    return 0
  fi

  return 1
}

if emit_if_matching "${SYNAPSE_PYTHON_BIN:-}"; then
  exit 0
fi

for candidate in \
  python3.11 \
  /opt/homebrew/bin/python3.11 \
  /usr/local/bin/python3.11 \
  "$HOME/.pyenv/shims/python3.11"; do
  if emit_if_matching "$candidate"; then
    exit 0
  fi
done

DEFAULT_PYTHON="$(command -v python3 2>/dev/null || true)"
DEFAULT_VERSION=""
if [[ -n "$DEFAULT_PYTHON" ]]; then
  DEFAULT_VERSION="$(version_of "$DEFAULT_PYTHON")"
fi

echo "Error: Synapse Python baseline is 3.11.x, but no usable Python 3.11 interpreter was found." >&2
if [[ -n "$DEFAULT_PYTHON" ]]; then
  echo "Detected default python3: $DEFAULT_PYTHON (${DEFAULT_VERSION:-unknown})" >&2
fi
echo "Install Python 3.11 and ensure python3.11 is on PATH, or set SYNAPSE_PYTHON_BIN to an explicit Python 3.11 binary." >&2
exit 1