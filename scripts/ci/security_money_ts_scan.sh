#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

TS_MONEY_TARGETS=(
  "$ROOT_DIR/services/admin-front/src/features/dashboard/analytics-presenters.ts"
  "$ROOT_DIR/services/admin-front/src/features/finance/finance-presenters.ts"
  "$ROOT_DIR/services/admin-front/src/features/approval/approval-presenters.ts"
  "$ROOT_DIR/services/admin-front/src/features/withdrawal-reviews/review-presenters.ts"
  "$ROOT_DIR/services/user-front/src/utils/refundApi.ts"
  "$ROOT_DIR/services/user-front/src/hooks/useFundsData.ts"
  "$ROOT_DIR/services/user-front/src/hooks/useSettlementData.ts"
  "$ROOT_DIR/services/user-front/src/components/dashboard-workspace/OwnerCreditsPage.tsx"
  "$ROOT_DIR/services/user-front/src/components/dashboard-workspace/DashboardInvocationsContent.tsx"
  "$ROOT_DIR/services/user-front/src/components/dashboard/agents/QuickStartGuide.tsx"
)

echo "[ci:security] scanning money-sensitive TypeScript files for raw money-number coercion"

MATCHES="$(rg -n '(^|[^[:alnum:]_])Number\([^)]*amountUsdc|(^|[^[:alnum:]_])Number\([^)]*refundUsdc|(^|[^[:alnum:]_])Number\([^)]*withdrawalUsdc|(^|[^[:alnum:]_])Number\([^)]*platformFee|(^|[^[:alnum:]_])Number\([^)]*providerNet|(^|[^[:alnum:]_])Number\([^)]*gmvUsdc|parseFloat\([^)]*amount|parseFloat\([^)]*Usdc|amountUsdc:\s*number\b|feeUsdc:\s*number\b|netUsdc:\s*number\b|targetBalance:\s*number\b' "${TS_MONEY_TARGETS[@]}" || true)"

if [[ -n "${MATCHES//$'\n'/}" ]]; then
  echo "[ci:security] forbidden money-number coercion detected in TypeScript money-sensitive files:" >&2
  printf '%s\n' "$MATCHES" >&2
  exit 1
fi

echo "[ci:security] money-sensitive TypeScript scan passed"
