#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

MONEY_TARGETS=(
  "$ROOT_DIR/services/gateway/src/domain/finance.py"
  "$ROOT_DIR/services/gateway/src/api/schemas/pydantic_models.py"
  "$ROOT_DIR/services/gateway/src/domain/invocation_response.py"
  "$ROOT_DIR/services/gateway/src/services/analytics/gateway_events.py"
  "$ROOT_DIR/services/gateway/src/services/platform/finance_service.py"
  "$ROOT_DIR/services/gateway/src/services/provider/withdraw_helpers_mixin.py"
  "$ROOT_DIR/services/gateway/src/services/provider/withdraw_execution_mixin.py"
  "$ROOT_DIR/services/gateway/src/services/provider/withdraw_service.py"
)

echo "[ci:security] scanning money-sensitive Python files for forbidden float usage"

MATCHES="$(rg -n ':\s*float\b|->\s*float\b|Field\(.*float\b|round\(float\(|float\(' "${MONEY_TARGETS[@]}" || true)"
MATCHES="$(printf '%s\n' "$MATCHES" | grep -v 'forbidden for amountUsdc' | grep -v '禁止业务层使用 float' || true)"

if [[ -n "${MATCHES//$'\n'/}" ]]; then
  echo "[ci:security] forbidden float usage detected in money-sensitive files:" >&2
  printf '%s\n' "$MATCHES" >&2
  exit 1
fi

echo "[ci:security] money-sensitive float scan passed"
