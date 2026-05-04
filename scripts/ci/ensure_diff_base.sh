#!/usr/bin/env bash

set -euo pipefail

BASE_REF="${1:-${QUALITY_BASE_REF:-origin/main}}"

fatal() {
  cat >&2 <<EOF
FATAL DIFF-BASE-001: unable to resolve diff base '${BASE_REF}'.
Why dangerous: diff-based gates cannot distinguish new code from historical
debt without the base branch history, so they could silently miss new risk or
block unrelated work.
Agent fix: fetch the base branch history before running the gate. In GitHub
Actions use:
  - uses: actions/checkout@v6
    with:
      fetch-depth: 0
For local runs, try: git fetch origin main --depth=200
EOF
  exit 1
}

if git rev-parse --verify "${BASE_REF}^{commit}" >/dev/null 2>&1; then
  exit 0
fi

if [[ "$BASE_REF" == origin/* ]]; then
  BRANCH="${BASE_REF#origin/}"
  echo "[diff-base] ${BASE_REF} missing; attempting git fetch origin ${BRANCH} --depth=200"
  git fetch origin "$BRANCH" --depth=200 >/dev/null 2>&1 || true
fi

git rev-parse --verify "${BASE_REF}^{commit}" >/dev/null 2>&1 || fatal
