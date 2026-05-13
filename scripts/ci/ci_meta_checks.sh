#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$ROOT_DIR"

echo "[ci:meta] checking workflow runtime guard"
npm run ci:github-actions-runtime

echo "[ci:meta] checking created_at index governance"
npm run ci:created-at-indexes

echo "[ci:meta] checking llms link integrity"
npm run ci:llms-links

echo "[ci:meta] checking SEO/public asset governance"
npm run ci:seo-public-assets

echo "[ci:meta] checking PR CI scope rules"
node --test scripts/ci/resolve_pr_ci_scope.test.mjs
