#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ENV="${DEPLOY_ENV:-${1:-production}}"
ROLLBACK_TARGET_SHA="${ROLLBACK_TARGET_SHA:-${2:-}}"

if [[ -z "${ROLLBACK_TARGET_SHA}" ]]; then
  echo "ROLLBACK_TARGET_SHA is required" >&2
  exit 1
fi

case "${DEPLOY_ENV}" in
  staging)
    COMMIT_SHA="${ROLLBACK_TARGET_SHA}" "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/staging.sh"
    ;;
  production)
    ROLLBACK_TARGET_SHA="${ROLLBACK_TARGET_SHA}" "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/production.sh"
    ;;
  *)
    echo "DEPLOY_ENV must be staging or production" >&2
    exit 1
    ;;
esac
