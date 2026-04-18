# BUG-ANALYTICS-03: Admin Analytics money fields returned floats

## Status

Fixed on 2026-04-18.

## Symptom

The local Admin Analytics ClickHouse regression failed on:

```text
GET /api/admin/v1/dashboard/analytics/invocation-revenue?window=24h
```

The API returned 500 because `AnalyticsInvocationRevenue` expects money fields as strings, but the ClickHouse analytics repository returned `0.0` floats for empty-window money aggregates.

## Root Cause

`services/gateway-admin/src/storage/analytics/analytics_dashboard.py` had already moved response schemas to the money contract, but the repository still used `_float(...)` for USDC fields. This made empty datasets fail validation and also violated the repository-wide money rule:

```text
Money crosses boundaries as string, computes as Decimal, stores as NUMERIC.
```

## Fix

- Added `_money(...)` to serialize ClickHouse money aggregates into canonical 6-decimal strings.
- Updated invocation revenue, provider revenue, money flow, risk budget, and overview money fields to return strings.
- Kept latency, rates, counts, and generic distribution metrics numeric.
- Added repository tests that assert money fields are returned as strings.

## Verification

- `cd services/gateway-admin && PYTHONPATH=. .venv/bin/pytest tests/test_analytics_dashboard_repository.py -q`
  - Result: 8 passed.
- `ADMIN_ANALYTICS_E2E_SEED_SESSION=true ADMIN_GATEWAY_URL=http://127.0.0.1:8300 ADMIN_ANALYTICS_WINDOW=24h ANALYTICS_FULLCHAIN_SCREENSHOT_DIR=artifacts/screenshots/2026-04-18-log-monitor ADMIN_ANALYTICS_REGRESSION_REPORT=artifacts/screenshots/2026-04-18-log-monitor/admin-clickhouse-regression.json python scripts/admin_analytics_clickhouse_regression.py`
  - Result: 57 passed, 0 failed.
- `bash scripts/ci/pr_checks.sh`
  - Result: passed.
- Screenshot artifacts:
  - `artifacts/screenshots/2026-04-18-log-monitor/01-analytics-overview.png`
  - `artifacts/screenshots/2026-04-18-log-monitor/02-consumer-funnel.png`
  - `artifacts/screenshots/2026-04-18-log-monitor/03-invocation-revenue.png`
  - `artifacts/screenshots/2026-04-18-log-monitor/04-provider-revenue.png`
  - `artifacts/screenshots/2026-04-18-log-monitor/05-money-flow.png`
  - `artifacts/screenshots/2026-04-18-log-monitor/06-risk-health.png`
  - `artifacts/screenshots/2026-04-18-log-monitor/07-data-quality.png`
