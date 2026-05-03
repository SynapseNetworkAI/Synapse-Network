---
id: admin-analytics-page-function-verification
title: Admin Analytics Page Function and Verification
status: canonical
created_at: 2026-04-20
updated_at: 2026-05-03
owner: admin-front
verified_with:
  - npm run ci:docs
  - services/gateway/tests/e2e/test_08_analytics_fullchain.py
  - scripts/admin_analytics_clickhouse_regression.py
  - scripts/admin_analytics_fullchain_e2e.js
---

# Admin Analytics Page Function and Verification

This document defines what every `admin-front` Analytics page is responsible for, which Gateway event chain it analyzes, and how dogfood automation proves that Gateway events reached the configured raw analytics source and are rendered correctly by the admin UI.

Admin Analytics is read-only. `gateway-admin` now defaults to Postgres-backed analytics through `synapse_analytics_outbox`; `admin-front` renders those API responses and must not invent analytics truth or fall back to mock/demo metrics. ClickHouse is an explicit compatibility source only when `ADMIN_ANALYTICS_SOURCE=clickhouse`.

For high-volume local/staging proof, use the dedicated 10,000 invocation dogfood runbook:
[Admin_Analytics_10k_Load_Dogfood_Verification.md](./Admin_Analytics_10k_Load_Dogfood_Verification.md).
That suite registers three Provider services, sends 10,000 paid calls, and verifies Admin Analytics with a baseline + delta model so older raw analytics rows do not pollute the verdict.

## Architecture

```text
Gateway runtime events
  -> Analytics emitter / ingestion
  -> Postgres analytics outbox
  -> gateway-admin /api/admin/v1/dashboard/analytics/*
  -> admin-front /dashboard/analytics*
  -> dogfood screenshots + JSON report
```

Screenshots are visual evidence. Pass/fail is based on browser clicks, gateway-admin API responses, and raw Postgres SQL aggregation for the Admin regression gate.

## Page Matrix

| Page                       | Route                                     | Gateway-admin API                                      | Function                                                                                            | Primary event chain                                                                                                                                         |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Analytics Overview         | `/dashboard/analytics`                    | `/api/admin/v1/dashboard/analytics/overview`           | Shows North Star metrics, Analytics Health, and actionable alerts before drilling into topic pages. | `invoke_completed`, `invoke_failed`, `provider_revenue_received`, `budget_blocked`, `risk_rule_triggered`                                                   |
| Consumer Activation Funnel | `/dashboard/analytics/consumer-funnel`    | `/api/admin/v1/dashboard/analytics/consumer-funnel`    | Finds where Consumers drop between discovery, funding, and first paid invocation.                   | `page_viewed -> wallet_connected -> consumer_signup_completed -> quote_generated -> deposit_completed -> invoke_started -> invoke_completed`                |
| Invocation Revenue         | `/dashboard/analytics/invocation-revenue` | `/api/admin/v1/dashboard/analytics/invocation-revenue` | Tracks quote/invoke volume, GMV, fees, latency, and failure causes.                                 | `quote_generated -> invoke_started -> invoke_completed/provider_revenue_received`; failures use `invoke_failed`                                             |
| Provider Revenue           | `/dashboard/analytics/provider-revenue`   | `/api/admin/v1/dashboard/analytics/provider-revenue`   | Shows whether Providers earned money and whether settlement is blocked.                             | `provider_revenue_received`, `provider_first_revenue_received`, `settlement_claim_requested`, `settlement_claim_completed`, `settlement_claim_failed`       |
| Money Flow                 | `/dashboard/analytics/money-flow`         | `/api/admin/v1/dashboard/analytics/money-flow`         | Observes deposits, withdrawals, refunds, confirmation latency, and failure samples.                 | `deposit_completed`, `deposit_failed`, `withdrawal_completed`, `withdrawal_failed`, `refund_completed`                                                      |
| Risk Health                | `/dashboard/analytics/risk-health`        | `/api/admin/v1/dashboard/analytics/risk-health`        | Tracks risk rules, budget blocks, provider health degradation, and refund reasons.                  | `risk_rule_triggered`, `budget_blocked`, `provider_health_degraded`, `refund_completed`                                                                     |
| Data Quality               | `/dashboard/analytics/data-quality`       | `/api/admin/v1/dashboard/analytics/data-quality`       | Verifies that analytics itself is trustworthy.                                                      | all events, plus checks for duplicates, source coverage, critical freshness, privacy violations, missing properties, XOR violations, lag, and file fallback |

## Page Responsibilities

### Analytics Overview

The overview answers: "Is growth, revenue, risk, or tracking quality unhealthy right now?"

Required UI:

- Window switcher: `24h`, `7d`, `30d`.
- North Star cards: `GMV USDC`, `Paid Invokes`, `Success Rate`, `Platform Fee`, `Provider Net`, `Analytics Health`.
- Critical/warning alerts with real drilldown links.
- Six topic cards that preserve the current `window` query parameter.

Verification:

- Browser opens `/dashboard/analytics`.
- The script switches all three windows.
- It clicks each topic card and validates the target route.
- If the overview contains a `Budget blocks` alert, clicking `查看` must navigate to `/dashboard/analytics/risk-health?window=<window>&focus=budget_blocked`.
- Each visible metric must match the gateway-admin API response; core cards must also match raw Postgres aggregation for Admin regression.

### Consumer Activation Funnel

The funnel answers: "Can a Consumer reach first paid invocation, and where do they drop?"

Required UI:

- Summary cards for activation rate, first invoke users, quote-to-invoke rate, and deposit-to-first-invoke rate.
- Ordered ladder for the fixed event chain.
- Users, events, conversion, and dropoff for every step.

Verification:

- Postgres analytics rows must contain at least the critical funnel events for the dogfood `runId`.
- API step counts must match raw distinct `distinct_id` and event counts.
- UI must show the same step labels and values returned by the API.

### Invocation Revenue

This page answers: "Are paid calls completing, how much revenue did they produce, and why did failures happen?"

Required UI:

- Cards for quotes, started, completed, failed, success rate, GMV, platform fee, provider net, and latency.
- Trend table with completed, failed, GMV, platform fee, and provider net buckets.
- Failure-stage and error-code distributions.

Verification:

- Dogfood seed must include at least one `invoke_failed` sample.
- API counts, GMV, platform fee, provider net, and p95 latency must match raw analytics SQL.
- UI must show at least one backend card value and the failure distribution when the seed generated failures.

### Provider Revenue

This page answers: "Did Providers earn and can they settle?"

Required UI:

- Provider gross, platform fee, provider net, first revenue, and settlement cards.
- Settlement funnel for `provider_revenue_received`, `provider_first_revenue_received`, and settlement claim events.
- Top providers table.
- Any field named `pendingSettlementUsdc` is displayed as "Available to withdraw" when sourced from finance projection; it is not a window-local settlement pending metric.

Verification:

- Dogfood seed must include `provider_revenue_received`, `provider_first_revenue_received`, and `settlement_claim_*` samples.
- API revenue and settlement values must match raw analytics aggregation.
- UI must not label provider available balance as "Pending settlement".

### Money Flow

This page answers: "Are deposits, withdrawals, refunds, and confirmations flowing?"

Required UI:

- Deposit, withdrawal, refund, confirmation latency, pending context, and error distributions.
- Recent failed deposit samples with timestamp, error code, amount, environment, and correlation or tx hash.

Verification:

- Dogfood seed must include `deposit_failed` with a stable error code such as `INVALID_INTENT`.
- API totals and failed counts must match raw analytics rows.
- UI must show failed-deposit sample rows when samples exist.

### Risk Health

This page answers: "What risk controls are firing, and can an operator trace them?"

Required UI:

- Critical risk events, budget gap, provider degraded count, risk rule distribution, surface distribution, refund reasons.
- Budget block aggregation and recent samples.
- `focus=budget_blocked` highlights the budget block panel.

Verification:

- Dogfood seed must include `budget_blocked`, `risk_rule_triggered`, `provider_health_degraded`, and `refund_completed`.
- Overview alert drilldown must land on the focused budget block panel.
- API risk summaries and sample rows must match raw analytics rows.

### Data Quality

This page answers: "Can we trust the analytics stream?"

Required UI:

- Window switcher: `1h`, `24h`.
- Event count, duplicate rate, source coverage, critical freshness, privacy violations, missing required properties, XOR violations, lag, and file fallback cards.
- Schema issue sample table.

Verification:

- Postgres raw query must show event count greater than zero for dogfood.
- Privacy violations must be zero for hashed wallet events.
- Critical freshness must include `page_viewed`, `wallet_connected`, `invoke_completed`, and `deposit_completed`.
- API data-quality response must match raw analytics counters.

## Dogfood Commands

Run the full Gateway to Admin Analytics verification:

```bash
cd services/gateway
ANALYTICS_FULLCHAIN_E2E=true \
ADMIN_ANALYTICS_SOURCE=postgres \
PYTHONPATH=. pytest tests/e2e/test_01_infrastructure.py \
  tests/e2e/test_02_wallet_auth.py \
  tests/e2e/test_03_fund_wallet.py \
  tests/e2e/test_04_deposit.py \
  tests/e2e/test_05_provider_register.py \
  tests/e2e/test_06_agent_credential.py \
  tests/e2e/test_07_invoke.py \
  tests/e2e/test_08_analytics_fullchain.py -q

cd ../..
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ADMIN_ANALYTICS_SOURCE=postgres \
npm run e2e:admin-analytics-10k:reconcile

ADMIN_FRONT_URL=http://127.0.0.1:4000 \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ADMIN_SESSION_TOKEN="<synapse_admin_session>" \
node scripts/admin_analytics_fullchain_e2e.js
```

Run the high-volume 10,000 invocation dogfood:

```bash
ADMIN_ANALYTICS_SOURCE=postgres \
ANALYTICS_TRANSPORT=outbox \
ADMIN_ANALYTICS_LOAD_TOTAL=10000 \
ADMIN_ANALYTICS_LOAD_CONCURRENCY=32 \
GATEWAY_BASE_URL=http://127.0.0.1:8000 \
npm run e2e:admin-analytics-10k:fullchain

ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ADMIN_ANALYTICS_SOURCE=postgres \
npm run e2e:admin-analytics-10k:reconcile

ADMIN_FRONT_URL=http://127.0.0.1:4000 \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ADMIN_SESSION_TOKEN="<synapse_admin_session>" \
npm run e2e:admin-analytics-10k:dogfood
```

## Acceptance Criteria

- `output/analytics-fullchain/report.json` has `status: "success"` and includes the dogfood `marker`.
- Required real business events and supplemental coverage events exist in Postgres analytics rows.
- Analytics reconciliation report has `status: "success"` and records `analyticsSource: "postgres"` for Admin regression.
- `output/analytics-fullchain/admin-page-verification.json` has `status: "success"`.
- Seven screenshots exist under `output/analytics-fullchain/screens/`.
- Browser click checks pass for window switchers, drilldown cards, sidebar/menu navigation, and budget-block alert drilldown.
- Any failure creates a bugfix record under the appropriate `docs/reference/bugfix/` subdirectory before the suite is marked complete.

For the 10k suite, pass additionally requires:

- `output/analytics-load/<runId>/fixture.json` contains three registered Provider services and 10,000 successful receipts.
- `output/analytics-load/<runId>/report.json` has `status: "success"`.
- `output/analytics-load/<runId>/admin-page-verification.json` has `status: "success"`.
- The post-run raw analytics delta includes at least `+10000` `invoke_completed` rows and the expected receipt total-charge GMV. The report also records the `7900.000000 USDC` service-price baseline for semantic review.
