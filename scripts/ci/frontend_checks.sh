#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT_DIR/services/user-front"

# GitHub runners do not have developer-local .env.local files. Keep the
# user-front fail-fast env preflight enabled, but provide non-secret public
# defaults for the build step. Do not export these globally: several unit tests
# intentionally verify no-env local fallback behavior.
echo "[ci:frontend] running next.js quality gate in $APP_DIR"
cd "$APP_DIR"

node "$ROOT_DIR/scripts/ci/user_front_external_links_check.mjs"
yarn lint
yarn test

NEXT_PUBLIC_GATEWAY_BASE_URL="${NEXT_PUBLIC_GATEWAY_BASE_URL:-http://127.0.0.1:8000}" \
NEXT_PUBLIC_ANALYTICS_ENDPOINT="${NEXT_PUBLIC_ANALYTICS_ENDPOINT:-http://127.0.0.1:8000/api/v1/events}" \
NEXT_PUBLIC_APP_ENV="${NEXT_PUBLIC_APP_ENV:-local}" \
NEXT_PUBLIC_DOCS_BASE_URL="${NEXT_PUBLIC_DOCS_BASE_URL:-http://localhost:3100}" \
NEXT_PUBLIC_TX_EXPLORER_BASE_URL="${NEXT_PUBLIC_TX_EXPLORER_BASE_URL:-http://localhost:5100}" \
NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS="${NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS:-20000}" \
NEXT_PUBLIC_SUPPORT_EMAIL="${NEXT_PUBLIC_SUPPORT_EMAIL:-support@synapse-network.ai}" \
NEXT_PUBLIC_SUPPORT_PORTAL_URL="${NEXT_PUBLIC_SUPPORT_PORTAL_URL:-}" \
  yarn build
