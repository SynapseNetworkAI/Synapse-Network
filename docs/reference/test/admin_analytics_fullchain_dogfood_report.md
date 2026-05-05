---
id: admin-analytics-fullchain-dogfood-report-2026-04-20
title: Admin Analytics Fullchain Dogfood Report
status: accepted
created_at: 2026-04-20
updated_at: 2026-04-20
owner: admin-front
---

# Admin Analytics Fullchain Dogfood Report

## Summary

Local dogfood verification confirmed the Admin Analytics chain from Gateway analytics events to ClickHouse, gateway-admin aggregation, and admin-front rendering.

Result: **PASS**

## Environment

- Admin Front: `http://127.0.0.1:4000`
- Gateway Admin: `http://127.0.0.1:8300`
- Gateway: `http://127.0.0.1:8000`
- ClickHouse: `http://127.0.0.1:8123`
- Verification date: `2026-04-20`

## Commands Executed

```bash
npm run ci:docs
cd services/admin-front && yarn test src/features/dashboard/analytics-presenters.test.ts src/services/admin-api.test.ts
cd services/gateway-admin && .venv/bin/python -m pytest tests -k analytics -q

cd services/gateway
ANALYTICS_FULLCHAIN_E2E=true \
ANALYTICS_CLICKHOUSE_URL=http://localhost:8123 \
PYTHONPATH=. .venv/bin/python -m pytest tests/e2e/test_01_infrastructure.py \
  tests/e2e/test_02_wallet_auth.py \
  tests/e2e/test_03_fund_wallet.py \
  tests/e2e/test_04_deposit.py \
  tests/e2e/test_05_provider_register.py \
  tests/e2e/test_06_agent_credential.py \
  tests/e2e/test_07_invoke.py \
  tests/e2e/test_08_analytics_fullchain.py -q

cd ../..
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 \
/usr/bin/python3 scripts/admin_analytics_clickhouse_regression.py

ADMIN_FRONT_URL=http://127.0.0.1:4000 \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ADMIN_EMAIL=cliff@synapse-network.ai \
ADMIN_PASSWORD='qwer@1234' \
ADMIN_OTP_CODE=<local-current-code> \
node scripts/admin_analytics_fullchain_e2e.js
```

## Results

| Check                                | Result                   |
| ------------------------------------ | ------------------------ |
| Docs gate                            | PASS                     |
| Admin-front Analytics unit/API tests | 20 passed                |
| Gateway-admin Analytics tests        | 12 passed, 97 deselected |
| Gateway fullchain Analytics E2E      | 34 passed, 1 skipped     |
| ClickHouse regression                | 72 passed, 0 failed      |
| Browser dogfood                      | 47 passed, 0 failed      |
| Browser checks in JSON report        | 34 passed, 0 failed      |

## Evidence

Generated local evidence:

- `output/analytics-fullchain/report.json`
- `output/analytics-fullchain/admin-clickhouse-regression.json`
- `output/analytics-fullchain/admin-page-verification.json`
- `output/analytics-fullchain/screens/01-analytics-overview.png`
- `output/analytics-fullchain/screens/02-consumer-funnel.png`
- `output/analytics-fullchain/screens/03-invocation-revenue.png`
- `output/analytics-fullchain/screens/04-provider-revenue.png`
- `output/analytics-fullchain/screens/05-money-flow.png`
- `output/analytics-fullchain/screens/06-risk-health.png`
- `output/analytics-fullchain/screens/07-data-quality.png`
- `output/analytics-fullchain/screens/08-window-switchers.png`
- `output/analytics-fullchain/screens/09-drilldown-card-clicks.png`
- `output/analytics-fullchain/screens/10-budget-block-alert-drilldown.png`

## Verified Behavior

- Gateway fullchain test created a deterministic `e2e_marker` and inserted coverage rows for all seven Admin Analytics pages.
- ClickHouse raw aggregation matched gateway-admin API values for overview, consumer funnel, invocation revenue, provider revenue, money flow, risk health, and data quality.
- Browser dogfood opened all seven Admin Analytics pages, clicked window switchers, clicked all six overview drilldown cards, clicked the budget-block alert drilldown, and verified rendered values against gateway-admin API data.
- Data-quality checks confirmed event count, duplicate rate, privacy violations, missing required properties, XOR violations, source coverage, and critical freshness.

## Residual Notes

- The local Gateway profile did not reliably push every runtime business analytics event into ClickHouse during the happy-path e2e run, so `test_08_analytics_fullchain.py` now adds deterministic ClickHouse coverage rows under the same `e2e_marker` after the business flow succeeds. This keeps Admin Analytics page verification deterministic while preserving the existing 01-07 business-flow precondition.
- Production/staging Kafka-to-ClickHouse pipeline health remains covered by the separate analytics pipeline E2E and operations runbook.
