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

It is intentionally **not** part of `ci:pr`. It requires local or staging services, a local chain, Redis, Kafka, ClickHouse, an admin session, three live provider endpoints, and a real browser.

This verification is strict by default: Gateway Analytics must write to Kafka, ClickHouse must consume the Kafka topic through its Kafka Engine table and materialized view, and no fallback-file import or direct ClickHouse fixture insert may be used to claim a pass.

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

## Real Monitoring Events

The 10,000 successful paid calls cover the happy path. Additional monitoring coverage must be produced through Gateway APIs or real Gateway runtime behavior so the event still flows through Kafka to ClickHouse.

The local/staging strict script currently triggers:

- frontend funnel events via `POST /api/v1/events`: `page_viewed`, `wallet_connected`, `consumer_signup_completed`, `provider_signup_completed`.
- real Gateway budget rejection via a low-limit credential: `budget_blocked`.
- real business path events from the main flow: `service_registered`, `deposit_completed`, `quote_generated`, `invoke_started`, `invoke_completed`, `provider_revenue_received`.

If a page requires a signal that cannot be produced by a stable public/runtime path, the report must mark that signal as `real-only not covered` rather than inserting synthetic ClickHouse rows. Direct `INSERT INTO synapse_analytics.events` from this dogfood suite is forbidden.

## Commands

Prepare local strict dependencies. This starts Redis, Kafka, and ClickHouse from `infra/docker/local/docker-compose.yml`, restarts Gateway with `REDIS_URL`, `ANALYTICS_KAFKA_BOOTSTRAP_SERVERS`, and `ANALYTICS_STRICT_KAFKA=1`, then verifies `/health` and the strict Kafka startup log:

```bash
npm run e2e:admin-analytics-10k:prepare
```

The local prepare script uses a load-test Gateway profile: Kafka/ClickHouse analytics are strict and real, while unrelated background workers are disabled by default (`V2_BACKFILL_ENABLED=0`, `V2_RECONCILIATION_ENABLED=0`, withdraw reapers/processors off, service health monitor off, and forwarding health gating relaxed). This does not mock Analytics data. It keeps the test focused on provider registration, paid invoke, ledger receipts, Gateway analytics emission, Kafka ingestion, ClickHouse aggregation, gateway-admin APIs, and admin-front rendering. Production/staging readiness for the disabled workers is covered by their own runbooks and must not be inferred from this 10k Analytics load run.

Run the fullchain load:

```bash
ADMIN_ANALYTICS_STRICT_REAL_PIPELINE=1 \
ADMIN_ANALYTICS_LOAD_TOTAL=10000 \
ADMIN_ANALYTICS_LOAD_CONCURRENCY=32 \
ADMIN_ANALYTICS_LOAD_PER_SERVICE_CONCURRENCY=1 \
ADMIN_ANALYTICS_LOAD_FORCE_PROBE_KEEPALIVE_SEC=45 \
GATEWAY_BASE_URL=http://127.0.0.1:8000 \
ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 \
ANALYTICS_KAFKA_BOOTSTRAP_SERVERS=localhost:9092 \
npm run e2e:admin-analytics-10k:fullchain
```

`ADMIN_ANALYTICS_LOAD_CONCURRENCY` is the global load intent recorded in the report. `ADMIN_ANALYTICS_LOAD_PER_SERVICE_CONCURRENCY` controls each provider service lane and defaults to `1` so the test cooperates with the Gateway downstream adaptive concurrency guard. Increase it only when the provider target remains healthy and `SERVICE_BUSY` retry counts stay low.

`ADMIN_ANALYTICS_LOAD_FORCE_PROBE_KEEPALIVE_SEC` keeps the three dogfood services fresh through the existing internal Provider Services `force-probe` API while the long load is running. This does not weaken production discovery rules; it prevents local/staging health-monitor jitter or stale snapshots from removing otherwise healthy mock providers mid-test.

When this suite runs locally, it uses `ANALYTICS_STRICT_KAFKA=1` to override the normal local file backend. If Gateway starts in `Analytics: File-only mode`, if Kafka is unavailable, or if ClickHouse cannot query `synapse_analytics.events_kafka`, the run fails before any 10k result can be claimed.

Reconcile ClickHouse and `gateway-admin`:

```bash
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 \
npm run e2e:admin-analytics-10k:reconcile
```

Verify `admin-front` with screenshots:

```bash
ADMIN_FRONT_URL=http://localhost:4000 \
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
| `report.md` | Human-readable reconciliation summary with seven expected/ClickHouse/API/UI comparison tables. |
| `admin-page-verification.json` | Browser click, DOM, console, screenshot checks, and `adminFrontActual` values. |
| `admin-page-verification.md` | Human-readable browser verification report and screenshot list. |
| `screens/*.png` | Seven Analytics pages plus interaction screenshots. |

Do not commit `output/` evidence unless a release evidence bundle explicitly requests it.

## Page Assertions

### Analytics Overview

- Paid Invokes increases by at least `+10000`.
- GMV increases by at least the receipt total-charge value. The report also records the `7900.000000 USDC` service-price baseline.
- Platform Fee and Provider Net match `provider_revenue_received`.
- Budget alerts match real Gateway budget rejection events produced by the low-limit credential.

### Consumer Activation Funnel

- `quote_generated`, `invoke_started`, and `invoke_completed` event counts increase by at least `+10000`.
- User counts are distinct-user counts. They are expected to increase by one consumer, not by 10,000.
- Conversion and dropoff values match raw ClickHouse aggregation.

### Invocation Revenue

- Quote, started, completed, failed, success rate, GMV, and latency values match ClickHouse.
- Failure-stage and error-code distributions are compared when real runtime failures exist; the strict suite does not insert fake failure rows.

### Provider Revenue

- Provider gross, platform fee, and provider net match raw ClickHouse.
- Top provider includes the load-test provider.
- `Available to withdraw` remains a finance projection and is not treated as window-local settlement pending.

### Money Flow

- Deposit amount includes the test deposit delta.
- Failed deposit, withdrawal, and refund samples are compared when produced by real runtime paths. Missing synthetic samples do not pass silently; the report must show the actual ClickHouse/API values.

### Risk Health

- Budget blocks, risk rules, provider degraded, and refund reasons match raw ClickHouse. Only real Gateway/Kafka events count.
- The overview Budget blocks alert must navigate to `/dashboard/analytics/risk-health?window=<window>&focus=budget_blocked`.

### Data Quality

- Event count matches raw ClickHouse.
- Duplicate rate is zero for the run-specific rows.
- Raw wallet identifiers do not appear in `distinct_id`.
- Critical freshness and source coverage are surfaced.

## Acceptance Criteria

- `fixture.json` contains three service ids and 10,000 successful invocation receipts.
- `fixture.json` records `strict_kafka_clickhouse`, `fallbackImport.imported = 0`, and `directClickHouseFixtureRows = 0`.
- ClickHouse run rows include at least 10,000 `invoke_completed` and 10,000 `provider_revenue_received` events from Kafka.
- `report.json.status === "success"`.
- `admin-page-verification.json.status === "success"`.
- All seven page comparison tables pass across expected fixture, ClickHouse, gateway-admin API, and admin-front DOM.
- Browser console has no uncaught errors.
- Seven page screenshots and three interaction screenshots exist.
- Any failure creates a bugfix record under `docs/reference/bugfix/admin-front/`, `docs/reference/bugfix/gateway-admin/`, or `docs/reference/bugfix/gateway/` before the suite is marked complete.

## Current Local Verification Note

The 2026-04-20 local workstation run completed the strict 10,000-call flow with Redis, Kafka, ClickHouse, and Gateway strict Kafka mode enabled.

- Fullchain: `10,000` successful invokes across the three service prices.
- Distribution: `4000 / 3000 / 3000`.
- Service-price GMV: `7900.000000 USDC`.
- Receipt GMV: `7901.000000 USDC`.
- ClickHouse run rows: `invoke_completed=10000`, `provider_revenue_received=10000`.
- Reconcile report: `output/analytics-load/aal-20260420041934/report.md`, `status=success`.
- Browser dogfood: `69 passed, 0 failed`, including all seven Analytics pages, window switching, drilldown card clicks, Budget blocks alert navigation, and DOM value checks against the API/ClickHouse report.
- Screenshots: `output/analytics-load/aal-20260420041934/screens/`.

The earlier 30-call smoke is historical only and cannot be used as strict evidence because it predates the no-fallback rule. The strict 10k blocker is fixed and tracked in:

```text
docs/reference/bugfix/gateway/analytics/BUG-ADMIN-ANALYTICS-10K-LOCAL-LOAD-REDIS-BLOCKER.md
```

Do not mark the 10k gate complete using the 30-call smoke result or any report that imports fallback-file rows or inserts direct ClickHouse fixture rows.
