#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <label> <app-dir> <run-tests:true|false>" >&2
  exit 1
fi

LABEL="$1"
APP_DIR="$2"
RUN_TESTS="$3"

echo "[$LABEL] running next.js quality gate in $APP_DIR"
cd "$APP_DIR"

yarn lint
if [[ "$RUN_TESTS" == "true" ]]; then
  yarn test
fi
yarn build
