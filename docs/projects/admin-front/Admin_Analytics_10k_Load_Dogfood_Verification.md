---
id: admin-analytics-10k-load-dogfood-verification
title: Admin Analytics 10k Load Dogfood Verification
status: canonical
created_at: 2026-04-20
updated_at: 2026-04-20
owner: admin-front
verified_with:
  - node --check scripts/e2e/admin_analytics_10k_fullchain.mjs
  - node --check scripts/e2e/admin_analytics_10k_reconcile.mjs
  - node --check scripts/ui/dogfood_admin_analytics_10k.mjs
---

# Admin Analytics 10k Load Dogfood Verification

This runbook verifies that Gateway paid invocation analytics survive a realistic local/staging load shape and remain consistent across ClickHouse, `gateway-admin`, and `admin-front`.

It is intentionally **not** part of `ci:pr`. It requires local or staging services, a local chain, ClickHouse, an admin session, three live provider endpoints, and a real browser.

## Scenario

The fullchain script registers three callable provider services:

| Service | Price | Calls |
| --- | ---: | ---: |
| 10k Echo Lite | `0.100000 USDC` | `4000` |
| 10k Echo Core | `1.000000 USDC` | `3000` |
| 10k Echo Pro | `1.500000 USDC` | `3000` |

Expected service-price GMV is:

```text
4000 * 0.100000 + 3000 * 1.000000 + 3000 * 1.500000 = 7900.000000 USDC
```

The current Gateway Analytics metric named `price_usdc` is emitted from the consumer receipt `totalCharge`. If `GATEWAY_ROUTING_TAX` is non-zero, the Admin Analytics GMV card may be higher than the service-price GMV by `routing_tax * call_count`. The verifier records both values and treats the receipt total charge as the UI truth, while still showing the `7900.000000 USDC` service-price baseline for semantic review.

The script funds the consumer with `10000.000000 USDC`, creates one agent credential, and sends 10,000 calls through the Gateway with bounded concurrency. Every call has a unique request id and idempotency boundary.

Platform fee and Provider net are not hardcoded in the verifier. They are read from Gateway receipts, ledger/usage state, or ClickHouse `provider_revenue_received` rows.

## Baseline + Delta Rule

Do not clear ClickHouse before this test.

The suite captures a 24h ClickHouse baseline before load. After the load, it verifies:

1. Current absolute ClickHouse values match the seven `gateway-admin` Analytics APIs.
2. Current absolute UI values match the `gateway-admin` APIs.
3. `post_run_clickhouse - baseline_clickhouse` contains at least the expected 10,000 paid invokes and the receipt total-charge GMV for the run.
4. The run-specific ClickHouse rows identified by `runId/e2e_marker` and unique service ids contain the expected core events.

This makes the test safe to run in dirty local/staging environments where older analytics rows may still exist.

## Supplemental Monitoring Events

The 10,000 successful paid calls cover the happy path. The script also inserts deterministic ClickHouse fixture rows under the same `runId/e2e_marker` for pages that require negative or operational signals:

- `budget_blocked`
- `risk_rule_triggered`
- `provider_health_degraded`
- `deposit_failed`
- `withdrawal_completed`
- `withdrawal_failed`
- `refund_completed`
- `settlement_claim_requested`
- `settlement_claim_completed`
- `settlement_claim_failed`

Reports must label these as fixture coverage. They must not be presented as organic production traffic.

## Commands

Run the fullchain load:

```bash
ADMIN_ANALYTICS_LOAD_TOTAL=10000 \
ADMIN_ANALYTICS_LOAD_CONCURRENCY=32 \
ADMIN_ANALYTICS_LOAD_PER_SERVICE_CONCURRENCY=1 \
ADMIN_ANALYTICS_LOAD_FORCE_PROBE_KEEPALIVE_SEC=45 \
GATEWAY_BASE_URL=http://127.0.0.1:8000 \
ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 \
npm run e2e:admin-analytics-10k:fullchain
```

`ADMIN_ANALYTICS_LOAD_CONCURRENCY` is the global load intent recorded in the report. `ADMIN_ANALYTICS_LOAD_PER_SERVICE_CONCURRENCY` controls each provider service lane and defaults to `1` so the test cooperates with the Gateway downstream adaptive concurrency guard. Increase it only when the provider target remains healthy and `SERVICE_BUSY` retry counts stay low.

`ADMIN_ANALYTICS_LOAD_FORCE_PROBE_KEEPALIVE_SEC` keeps the three dogfood services fresh through the existing internal Provider Services `force-probe` API while the long load is running. This does not weaken production discovery rules; it prevents local/staging health-monitor jitter or stale snapshots from removing otherwise healthy mock providers mid-test.

When the Gateway runs with `ENVIRONMENT=local`, Analytics uses the file fallback backend instead of Kafka. In that profile, the fullchain script imports the real Gateway-emitted fallback-file rows into ClickHouse before reconciliation. This is a local transport bridge, not synthetic success traffic. Staging/prod verification should set `ADMIN_ANALYTICS_LOAD_IMPORT_GATEWAY_FILE_EVENTS=0` and require Kafka-to-ClickHouse delivery directly.

Reconcile ClickHouse and `gateway-admin`:

```bash
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 \
npm run e2e:admin-analytics-10k:reconcile
```

Verify `admin-front` with screenshots:

```bash
ADMIN_FRONT_URL=http://127.0.0.1:4000 \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ADMIN_SESSION_TOKEN="<synapse_admin_session>" \
npm run e2e:admin-analytics-10k:dogfood
```

Or run all three:

```bash
npm run e2e:admin-analytics-10k
```

## Output

The suite writes evidence under:

```text
output/analytics-load/<runId>/
```

Important files:

| File | Purpose |
| --- | --- |
| `fixture.json` | Wallet/session/service/deposit/credential/receipt/load fixture. |
| `report.json` | ClickHouse + gateway-admin reconciliation checks. |
| `report.md` | Human-readable reconciliation summary. |
| `admin-page-verification.json` | Browser click, DOM, console, and screenshot checks. |
| `screens/*.png` | Seven Analytics pages plus interaction screenshots. |

Do not commit `output/` evidence unless a release evidence bundle explicitly requests it.

## Page Assertions

### Analytics Overview

- Paid Invokes increases by at least `+10000`.
- GMV increases by at least the receipt total-charge value. The report also records the `7900.000000 USDC` service-price baseline.
- Platform Fee and Provider Net match `provider_revenue_received`.
- Budget and critical-risk alerts match the supplemental fixture rows.

### Consumer Activation Funnel

- `quote_generated`, `invoke_started`, and `invoke_completed` event counts increase by at least `+10000`.
- User counts are distinct-user counts. They are expected to increase by one consumer, not by 10,000.
- Conversion and dropoff values match raw ClickHouse aggregation.

### Invocation Revenue

- Quote, started, completed, failed, success rate, GMV, and latency values match ClickHouse.
- Failure-stage and error-code distributions show the controlled `invoke_failed` sample.

### Provider Revenue

- Provider gross, platform fee, and provider net match raw ClickHouse.
- Top provider includes the load-test provider.
- `Available to withdraw` remains a finance projection and is not treated as window-local settlement pending.

### Money Flow

- Deposit amount includes the test deposit delta.
- Failed deposit samples show the controlled `INVALID_INTENT` fixture.
- Withdrawal and refund totals match fixture and raw ClickHouse.

### Risk Health

- Budget blocks, risk rules, provider degraded, and refund reasons match raw ClickHouse.
- The overview Budget blocks alert must navigate to `/dashboard/analytics/risk-health?window=<window>&focus=budget_blocked`.

### Data Quality

- Event count matches raw ClickHouse.
- Duplicate rate is zero for the run-specific rows.
- Raw wallet identifiers do not appear in `distinct_id`.
- Critical freshness and source coverage are surfaced.

## Acceptance Criteria

- `fixture.json` contains three service ids and 10,000 successful invocation receipts.
- `report.json.status === "success"`.
- `admin-page-verification.json.status === "success"`.
- Browser console has no uncaught errors.
- Seven page screenshots and three interaction screenshots exist.
- Any failure creates a bugfix record under `docs/reference/bugfix/admin-front/`, `docs/reference/bugfix/gateway-admin/`, or `docs/reference/bugfix/gateway/` before the suite is marked complete.

## Current Local Verification Note

The 2026-04-20 local workstation run completed a 30-call smoke version of this flow and proved the core Analytics contract:

- Fullchain smoke: `30` successful invokes across the three service prices.
- Reconcile report: ClickHouse raw rows, `gateway-admin` APIs, and receipt totals matched.
- Browser dogfood: `37 passed, 0 failed`, including all seven Analytics pages, window switching, drilldown card clicks, and Budget blocks alert navigation.
- Evidence directory: `output/analytics-load/aal-20260420025537/`.

The full `ADMIN_ANALYTICS_LOAD_TOTAL=10000` local run is not yet claimed as passed on this workstation because Redis is not running and the Gateway downstream adaptive concurrency guard correctly returns `SERVICE_BUSY` under the 10k local load shape. The blocker is tracked in:

```text
docs/reference/bugfix/gateway/analytics/BUG-ADMIN-ANALYTICS-10K-LOCAL-LOAD-REDIS-BLOCKER.md
```

Staging verification must run with Redis/global downstream concurrency protection available, or with an explicitly reviewed deterministic local limiter profile. Do not mark the 10k gate complete using the 30-call smoke result.
