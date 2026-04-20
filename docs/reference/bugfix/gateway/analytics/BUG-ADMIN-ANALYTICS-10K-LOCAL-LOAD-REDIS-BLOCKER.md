---
id: bug-admin-analytics-10k-local-load-redis-blocker
title: Admin Analytics 10k strict local load needs Redis, Kafka, ClickHouse, and Gateway strict Kafka mode
status: fixed
created_at: 2026-04-20
updated_at: 2026-04-20
owner: gateway
---

# BUG-ADMIN-ANALYTICS-10K-LOCAL-LOAD-REDIS-BLOCKER

## Reproduction

Run the 10,000-call Admin Analytics load dogfood against the local Gateway profile without the strict local dependency preparation:

```bash
npm run e2e:admin-analytics-10k:prepare

ADMIN_ANALYTICS_STRICT_REAL_PIPELINE=1 \
ADMIN_ANALYTICS_LOAD_TOTAL=10000 \
ADMIN_ANALYTICS_LOAD_CONCURRENCY=12 \
ADMIN_ANALYTICS_LOAD_PER_SERVICE_CONCURRENCY=4 \
ADMIN_ANALYTICS_LOAD_FORCE_PROBE_KEEPALIVE_SEC=15 \
GATEWAY_BASE_URL=http://127.0.0.1:8000 \
ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 \
npm run e2e:admin-analytics-10k:fullchain
```

Before the strict prepare path existed, local Redis was not guaranteed to be running, Gateway did not start with `REDIS_URL`, and local Gateway Analytics started in file-only mode even when Kafka/ClickHouse existed. The old 30-call smoke imported local fallback-file events into ClickHouse, which is no longer acceptable for the 10k gate.

## Root Cause

The Gateway downstream adaptive concurrency guard correctly protects provider targets before billing. The 10k dogfood profile also needs the full analytics transport chain:

- Redis must be available so the local load profile exercises the intended distributed limiter path.
- Gateway must run with `ANALYTICS_STRICT_KAFKA=1`, otherwise local mode uses file-only analytics.
- Kafka and ClickHouse must be reachable, and ClickHouse must consume `synapse.analytics.events` through `synapse_analytics.events_kafka`.
- The 10k scripts must not import fallback-file rows or insert direct ClickHouse fixture rows.

This is not an Analytics aggregation correctness failure. It is a local dogfood environment and transport-mode blocker.

## Fix

Added a strict local preparation path for the 10k Analytics dogfood:

- `npm run e2e:admin-analytics-10k:prepare` starts Redis, Kafka, and ClickHouse from `infra/docker/local/docker-compose.yml`.
- The prepare script verifies Redis `PONG`, Kafka topic access, ClickHouse `synapse_analytics.events / events_kafka / events_kafka_mv`, and Gateway `/health`.
- Gateway is restarted with `REDIS_URL=redis://127.0.0.1:6379/0`, `ANALYTICS_KAFKA_BOOTSTRAP_SERVERS=localhost:9092`, and `ANALYTICS_STRICT_KAFKA=1`.
- `admin_analytics_10k_fullchain.mjs` now runs this prepare step by default in local strict mode.
- Strict mode forbids fallback-file imports and direct ClickHouse fixture inserts. All Analytics data must flow Gateway -> Kafka -> ClickHouse.

## Final Verification

Strict 10,000-call fullchain:

```bash
ADMIN_ANALYTICS_STRICT_REAL_PIPELINE=1 \
ADMIN_ANALYTICS_LOAD_PREPARE_LOCAL=1 \
ADMIN_ANALYTICS_LOAD_TOTAL=10000 \
ADMIN_ANALYTICS_LOAD_CONCURRENCY=32 \
ADMIN_ANALYTICS_LOAD_PER_SERVICE_CONCURRENCY=4 \
ADMIN_ANALYTICS_LOAD_FORCE_PROBE_KEEPALIVE_SEC=45 \
ADMIN_ANALYTICS_LOAD_BUSY_RETRIES=120 \
ADMIN_ANALYTICS_LOAD_TIMEOUT_MS=60000 \
GATEWAY_BASE_URL=http://127.0.0.1:8000 \
ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 \
ANALYTICS_KAFKA_BOOTSTRAP_SERVERS=localhost:9092 \
npm run e2e:admin-analytics-10k:fullchain
```

Reconcile:

```bash
ADMIN_ANALYTICS_LOAD_FIXTURE=output/analytics-load/aal-20260420041934/fixture.json \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 \
npm run e2e:admin-analytics-10k:reconcile
```

Browser dogfood:

```bash
ADMIN_ANALYTICS_LOAD_FIXTURE=output/analytics-load/aal-20260420041934/fixture.json \
ADMIN_ANALYTICS_LOAD_REPORT=output/analytics-load/aal-20260420041934/report.json \
ADMIN_FRONT_URL=http://localhost:4000 \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
npm run e2e:admin-analytics-10k:dogfood
```

Results:

- Evidence directory: `output/analytics-load/aal-20260420041934/`
- Fullchain: 10,000 successful invokes across 3 provider services.
- Distribution: `4000 / 3000 / 3000` at `0.100000 / 1.000000 / 1.500000 USDC`.
- Service-price GMV: `7900.000000 USDC`.
- Receipt GMV: `7901.000000 USDC`.
- ClickHouse `invoke_completed`: `10000/10000`.
- ClickHouse `provider_revenue_received`: `10000/10000`.
- 24h delta `quote_generated`: `10001/10000` minimum expected; the extra quote is the real budget-block probe.
- Reconcile report: `output/analytics-load/aal-20260420041934/report.md`, `status=success`.
- Browser dogfood report: `output/analytics-load/aal-20260420041934/admin-page-verification.md`, `69 passed, 0 failed`.
- Screenshots: `output/analytics-load/aal-20260420041934/screens/`.
- Strict pipeline assertions passed: `fallbackImport.imported = 0`, `directClickHouseFixtureRows = 0`, and required monitoring events were emitted through Gateway.

## Historical Smoke

The old 30-call fallback-file smoke is retained only as historical context. It is not accepted as evidence for the strict 10k gate.

## Residual Risk

The local run proves the strict Gateway -> Kafka -> ClickHouse analytics transport and Admin UI reconciliation path, but it also shows the full paid invoke path is throughput-limited on a single local workstation: the observed load rate was roughly 3 requests/sec. Production or staging performance acceptance still needs environment-specific capacity testing, but the original Redis/Kafka/ClickHouse strict local blocker is fixed.
