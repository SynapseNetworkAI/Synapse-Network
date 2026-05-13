#!/usr/bin/env bash

set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ripgrep
fi

if ! command -v uvx >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

echo "[ci:tools] rg=$(command -v rg)"
echo "[ci:tools] uvx=$(command -v uvx)"

if [[ -x "${GITHUB_WORKSPACE:-$PWD}/node_modules/.bin/prettier" ]]; then
  echo "[ci:tools] prettier=repo-local"
elif command -v prettier >/dev/null 2>&1; then
  echo "[ci:tools] prettier=$(command -v prettier)"
else
  echo "[ci:tools] prettier=not-required-in-this-job"
fi

if [[ -x "${GITHUB_WORKSPACE:-$PWD}/node_modules/.bin/jscpd" ]]; then
  echo "[ci:tools] jscpd=repo-local"
elif command -v jscpd >/dev/null 2>&1; then
  echo "[ci:tools] jscpd=$(command -v jscpd)"
else
  echo "[ci:tools] jscpd=not-required-in-this-job"
fi
