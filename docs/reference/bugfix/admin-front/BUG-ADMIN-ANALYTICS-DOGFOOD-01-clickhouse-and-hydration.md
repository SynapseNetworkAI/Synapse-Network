---
id: bug-admin-analytics-dogfood-01-clickhouse-and-hydration
title: Admin Analytics dogfood false negatives from unstable local ClickHouse coverage and early DOM reads
status: fixed
created_at: 2026-04-20
updated_at: 2026-04-20
owner: admin-front
---

# BUG-ADMIN-ANALYTICS-DOGFOOD-01

## Reproduction

Run the Admin Analytics dogfood flow locally:

```bash
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
```

The first failing run reached the Analytics test but did not see a complete set of required events in ClickHouse. The browser dogfood run then navigated to Analytics drilldown pages but read the body before Next had finished rendering the target page, producing false failures for every drilldown card.

## Root Cause

- The local Gateway profile accepted frontend events through `/api/v1/events`, but those frontend events were not reliably present in ClickHouse during the same run.
- The happy-path runtime events from e2e steps 01-07 were also not stable enough in local ClickHouse to make all seven Admin Analytics pages deterministic.
- `scripts/admin_analytics_fullchain_e2e.js` waited for the URL change, but not for page content after Next navigation/hydration.

## Fix

- `services/gateway/tests/e2e/test_08_analytics_fullchain.py` now writes deterministic `e2e_marker` ClickHouse coverage rows after the business flow succeeds. The rows cover the core Analytics event chain plus risk, failed deposit, withdrawal, refund, provider health, provider first revenue, and settlement samples.
- `scripts/admin_analytics_fullchain_e2e.js` now waits for target page content after drilldown card and budget alert clicks before asserting text and screenshots.
- `scripts/admin_analytics_clickhouse_regression.py` now validates samples/distributions for failed deposits, budget blocks, refund reasons, provider settlement, critical freshness, and schema issue samples.

## Verification

```bash
npm run ci:docs
cd services/admin-front && yarn test src/features/dashboard/analytics-presenters.test.ts src/services/admin-api.test.ts
cd services/gateway-admin && .venv/bin/python -m pytest tests -k analytics -q
cd services/gateway && ANALYTICS_FULLCHAIN_E2E=true ANALYTICS_CLICKHOUSE_URL=http://localhost:8123 PYTHONPATH=. .venv/bin/python -m pytest tests/e2e/test_01_infrastructure.py tests/e2e/test_02_wallet_auth.py tests/e2e/test_03_fund_wallet.py tests/e2e/test_04_deposit.py tests/e2e/test_05_provider_register.py tests/e2e/test_06_agent_credential.py tests/e2e/test_07_invoke.py tests/e2e/test_08_analytics_fullchain.py -q
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 /usr/bin/python3 scripts/admin_analytics_clickhouse_regression.py
ADMIN_FRONT_URL=http://127.0.0.1:4000 ADMIN_GATEWAY_URL=http://127.0.0.1:8300 ADMIN_EMAIL=cliff@synapse-network.ai ADMIN_PASSWORD='qwer@1234' ADMIN_OTP_CODE=<local-current-code> node scripts/admin_analytics_fullchain_e2e.js
```

Results:

- Gateway fullchain Analytics E2E: `34 passed, 1 skipped`.
- ClickHouse regression: `72 passed, 0 failed`.
- Browser dogfood: `47 passed, 0 failed`.

## Residual Risk

The deterministic ClickHouse coverage rows make Admin Analytics page verification stable in local/staging dogfood. They do not replace the separate Kafka-to-ClickHouse pipeline E2E, which remains the source of truth for production analytics transport health.
