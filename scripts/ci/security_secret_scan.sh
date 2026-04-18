#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[ci:security] scanning for hardcoded bootstrap secrets and local weak defaults"

MATCHES="$(rg -n \
  'JBSWY3DPEHPK3PXP|0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80|0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d|0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6|POSTGRES_PASSWORD=12345678|MINIO_ROOT_PASSWORD=minioadmin|MINIO_ROOT_USER=minioadmin' \
  "$ROOT_DIR/services/gateway/examples" \
  "$ROOT_DIR/services/gateway/scripts/diagnose_withdraw.py" \
  "$ROOT_DIR/services/gateway/scripts/verify_consumer_withdraw.py" \
  "$ROOT_DIR/scripts/browser_e2e_test.js" \
  "$ROOT_DIR/scripts/fullchain_consumer_withdraw_e2e.js" \
  "$ROOT_DIR/scripts/credits_withdraw_validation.js" \
  "$ROOT_DIR/infra/docker/local/docker-compose.yml" \
  "$ROOT_DIR/infra/postgres/init/gateway-admin/003_gateway_admin_projection_views.sql" \
  "$ROOT_DIR/infra/postgres/init/gateway/000_create_databases_and_roles.sh" || true)"

if [[ -n "${MATCHES//$'\n'/}" ]]; then
  echo "[ci:security] hardcoded secret material or weak local defaults detected:" >&2
  printf '%s\n' "$MATCHES" >&2
  exit 1
fi

echo "[ci:security] secret scan passed"
