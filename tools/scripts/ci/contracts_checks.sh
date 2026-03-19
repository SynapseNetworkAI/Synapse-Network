#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[ci:contracts] running contract quality gate in $ROOT_DIR"
cd "$ROOT_DIR"

npx hardhat compile

if [[ -d "$ROOT_DIR/test" ]] && find "$ROOT_DIR/test" -type f | grep -q .; then
  npx hardhat test
else
  echo "[ci:contracts] no root hardhat tests found, compile gate only"
fi
