---
id: gateway-production-performance-stability-optimization
title: Gateway Production Performance and Stability Optimization
status: canonical
created_at: 2026-04-20
updated_at: 2026-04-22
owner: gateway
verified_with:
  - npm run ci:docs
  - cd services/gateway && .venv/bin/python -m pytest tests/unit/test_analytics_outbox_unit.py tests/unit/test_notifications_outbox_unit.py tests/unit/test_forwarding_runtime_service_unit.py::test_upstream_http_pool_timeout_rolls_back_charge -q
  - python3 scripts/perf/gateway_http_client_pool_qps.py --requests 1000 --concurrency 64
---

# Gateway Production Performance and Stability Optimization

This document captures the production performance hardening direction for the Gateway paid invocation path. The goal is to improve throughput without weakening money safety, auditability, or Analytics correctness.

The current safe path is Postgres atomic charge per paid invocation. That remains the source of truth. The next optimizations must remove avoidable request-path I/O and hidden queueing while keeping ledger, audit, analytics evidence, and user/admin notifications recoverable.

## Design Principles

1. Money correctness beats raw throughput.
2. Kafka and ClickHouse are observability systems, not ledger source of truth.
3. Analytics events for successful paid invokes must never be lost after the ledger transaction commits.
4. Gateway API and Gateway worker responsibilities should be separated by runtime command, not by splitting repos or images.
5. Any local fast path must use USDC atomic integer units. Redis floating point operations are forbidden for money.

## Transactional Outbox For Finance Analytics

Funding, invoke billing, provider revenue, refund, withdrawal, and settlement events that represent money movement should move to a Transactional Outbox pattern.

The paid invoke transaction should commit ledger/audit/usage and the Analytics outbox rows in the same Postgres transaction. Kafka delivery then moves to a `gateway-worker` publisher loop. This removes Kafka `send_and_wait()` from the request path without losing the event after money has moved.

Required behavior:

1. `invoke_completed` and `provider_revenue_received` outbox rows are inserted in the same transaction as the successful consumer charge.
2. If the charge fails or rolls back, no success outbox rows are committed.
3. Kafka outage does not block paid invoke success after the DB transaction commits.
4. Outbox backlog and oldest pending age degrade readiness and trigger alerts.
5. ClickHouse, Admin Analytics, and dogfood reports must continue to reconcile against the outbox-delivered Kafka stream.

### Current Implementation Status

The first implementation slice is available behind `ANALYTICS_TRANSPORT=outbox`.

What is implemented:

1. `synapse_analytics_outbox` table, indexes, and schema contract.
2. `PostgresOutboxBackend`, which persists analytics events to Postgres instead of waiting on Kafka.
3. Outbox worker drain primitive with retry/dead-letter handling.
4. Multi-worker-safe claim using a lease transition backed by `FOR UPDATE SKIP LOCKED`.
5. Success rows are deleted after Kafka ack; sent history is not retained in the hot outbox table.
6. Worker command entrypoint:

```bash
cd services/gateway
.venv/bin/python -m src.worker analytics-outbox --once
.venv/bin/python -m src.worker analytics-outbox --poll-interval-sec 1
```

What is not yet claimed as fully complete:

1. The existing paid invoke pipeline charges before upstream completion and rolls back on upstream failure. Because of that control flow, `invoke_completed` and `provider_revenue_received` are not yet inserted inside the same final-success transaction as a ledger status transition.
2. Until the invoke success transition is consolidated into one final transaction, `ANALYTICS_TRANSPORT=outbox` should be treated as Kafka decoupling and durable delivery infrastructure, not the final zero-loss finance event proof.
3. Production Go/No-Go must still require the 10k outbox-mode path: ledger success -> outbox -> worker -> Kafka -> ClickHouse -> gateway-admin -> admin-front.

## Outbox Bloat Guard

`synapse_analytics_outbox` is a temporary delivery channel. It is not the historical archive.

Hard rules:

1. Worker success defaults to delete: `DELETE FROM synapse_analytics_outbox WHERE event_id = ANY(...)`.
2. Do not keep long-lived `status='sent'` rows in the hot outbox table.
3. Historical facts live in ledger, audit, usage, and ClickHouse, not in the outbox table.
4. Retain only `pending`, `retry`, and `dead_letter` rows in the hot outbox table.
5. Optional archival may apply to dead-letter rows or small audit samples only; do not archive every sent row by default.

Required index and monitoring:

```sql
CREATE INDEX IF NOT EXISTS idx_synapse_analytics_outbox_claim
ON synapse_analytics_outbox (status, next_attempt_at, created_at);
```

Metrics:

1. `analytics_outbox_pending`
2. `analytics_outbox_oldest_age_sec`
3. `analytics_outbox_dead_letter_count`
4. `analytics_outbox_deleted_total`
5. `analytics_outbox_publish_latency_ms`

## Transactional Outbox For Email Notifications

Email delivery follows the same request-path isolation rule as Analytics:
Gateway and Gateway-admin business paths enqueue notification intent only;
Gmail SMTP is called only by the `notification-outbox` worker.

Required behavior:

1. Finance state changes write notification intent in the same DB transaction
   when the email corresponds to a committed business state.
2. Gmail outage, quota errors, or SMTP timeout must not fail `invoke`,
   balance, deposit, withdrawal, approval, or reconciliation APIs.
3. Worker delivery is at-least-once. A worker crash after Gmail accepts a
   message but before DB commit may cause a duplicate email; that duplicate is
   acceptable because email is not the ledger source of truth.
4. Success rows are inserted into `synapse_notification_delivery_log` and then
   deleted from `synapse_notification_outbox`; do not keep long-lived
   `status='sent'` rows in the hot outbox table.
5. Provider income credited summaries are intentionally not emailed in V1.
   Provider revenue remains visible through dashboards and future explicit
   digest work.

Worker command:

```bash
cd services/gateway
.venv/bin/python -m src.worker notification-outbox --once
.venv/bin/python -m src.worker notification-outbox --poll-interval-sec 1
```

Gmail quota guard:

1. Track daily Gmail accepted sends through delivery log counts.
2. Trigger P1 before the Workspace daily quota is exhausted.
3. After the hard limit, defer low-priority `digest` and `ops` mail while
   allowing `security` and `transactional_high` notifications to remain
   eligible.
4. Never retry quota errors in a tight loop.

Required email outbox index:

```sql
CREATE INDEX IF NOT EXISTS idx_synapse_notification_outbox_claim
ON synapse_notification_outbox (status, next_attempt_at, priority, created_at);
```

Metrics:

1. `email_outbox_pending_total`
2. `email_outbox_oldest_pending_age_seconds`
3. `email_outbox_dead_letter_total`
4. `email_gmail_daily_quota_used`
5. `email_gmail_quota_exceeded_total`

## Worker Concurrency With `FOR UPDATE SKIP LOCKED`

Production may run multiple `gateway-worker` instances. They must not select the same outbox rows.

Worker claim SQL must use row locks and skip rows already claimed by another worker:

```sql
SELECT *
FROM synapse_analytics_outbox
WHERE status IN ('pending', 'retry')
  AND next_attempt_at <= now()
ORDER BY created_at ASC
LIMIT :batch_size
FOR UPDATE SKIP LOCKED;
```

Worker flow:

1. Open a short transaction and claim rows with `FOR UPDATE SKIP LOCKED`.
2. Send claimed rows to Kafka with stable event keys.
3. On Kafka ack success, delete claimed rows.
4. On failure, update `attempt_count`, `next_attempt_at`, and `last_error`.
5. After max attempts, mark the row `dead_letter` for repair.

Forbidden implementation:

```sql
SELECT *
FROM synapse_analytics_outbox
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 500;
```

That query is unsafe with multiple workers because each worker can read and publish the same rows.

Idempotency requirements:

1. Kafka key should be `event_id` or a stable business event id.
2. ClickHouse/reporting must detect duplicate `event_id` rows.
3. Dogfood reports must fail if duplicate rate is non-zero for run-specific paid invoke events.

## Gateway API And Worker Runtime Split

Use one codebase and one image, with separate runtime commands:

1. `gateway-api`: FastAPI/uvicorn request serving only.
2. `gateway-worker`: analytics outbox publishing, deposit indexer, withdraw watcher, reconciliation, and compensation loops.

This keeps CI/CD simple while separating failure domains. A stuck chain backfill or Kafka publisher must not block `/health`, login, discovery, invoke, or forum/support APIs.

Readiness should expose worker lag, outbox backlog, Kafka lag, ClickHouse lag, DB lock wait, and Redis health. Liveness should remain event-loop/process health only.

## Provider HTTP Client Pool

Provider forwarding should reuse application-level `httpx.AsyncClient` instances instead of creating a new client per invoke.

Client configuration must explicitly set:

1. `max_connections`
2. `max_keepalive_connections`
3. `connect_timeout`
4. `read_timeout`
5. `write_timeout`
6. `pool_timeout`

`httpx.PoolTimeout` must be treated as Gateway local capacity pressure, not as provider health failure.

Required `PoolTimeout` behavior:

1. Do not enter provider upstream call.
2. Do not charge the consumer.
3. Return `SERVICE_BUSY` or equivalent 503/429 semantics.
4. Emit `gateway_http_pool_timeout_total`.
5. Surface `http_client_pool_wait_ms` and `http_client_pool_saturation`.
6. Do not mark the provider target unhealthy solely because the local Gateway pool is saturated.

Provider slow responses remain the responsibility of downstream adaptive concurrency and circuit breaker. Local pool saturation is a Gateway capacity signal.

### Implemented HTTP Pool Settings

The provider invoke path now uses an application-level shared `httpx.AsyncClient` by default.

Configuration:

```bash
PROVIDER_HTTP_CLIENT_POOL_ENABLED=1
PROVIDER_HTTP_CLIENT_MAX_CONNECTIONS=256
PROVIDER_HTTP_CLIENT_MAX_KEEPALIVE_CONNECTIONS=64
PROVIDER_HTTP_CLIENT_CONNECT_TIMEOUT_SEC=1.0
PROVIDER_HTTP_CLIENT_WRITE_TIMEOUT_SEC=2.0
PROVIDER_HTTP_CLIENT_POOL_TIMEOUT_SEC=0.05
```

Verification:

```bash
python3 scripts/perf/gateway_http_client_pool_qps.py --requests 1000 --concurrency 64
```

This benchmark isolates provider HTTP client reuse. It does not replace the full paid-invoke 10k dogfood benchmark because the full chain is still dominated by ledger/account serialization and downstream provider behavior.

## Ledger Hotspot Strategy

The current Postgres atomic charge path is safe but serializes high-frequency calls against the same consumer/account/credential hot path.

Near-term allowed improvements:

1. Measure stage latency for every paid invoke: quote, budget, ledger, credential update, upstream, outbox, total.
2. Fold credential usage updates into the atomic charge path where possible.
3. Compare single-consumer load with multi-consumer load to quantify row-lock pressure.

Deferred high-throughput changes:

1. Redis pre-authorization bucket.
2. Agent sub-account sharding.
3. Short-window batch settlement.

Those changes require a separate RFC because they alter money movement semantics. If Redis is used for money buckets, it must store integer USDC atomic units only; Redis float operations are forbidden.

## Required Tests Before Production

1. Outbox bloat test: publish 10k outbox rows, verify successful rows are deleted and only pending/retry/dead-letter rows remain.
2. Worker concurrency test: run 3 workers against the same table, verify each `event_id` is published once.
3. Kafka outage test: paid invoke commits ledger and outbox while Kafka is unavailable, then worker drains backlog after Kafka recovers.
4. HTTP pool saturation test: small provider client pool causes fast `SERVICE_BUSY`, no charge, and capacity metrics.
5. Worker isolation test: chain backfill or outbox publisher stall does not block Gateway API `/health` or ordinary requests.
6. 10k Analytics regression: Postgres outbox -> worker -> Kafka -> ClickHouse -> gateway-admin -> admin-front, with no fallback import or direct ClickHouse insert.

## Production Pass Criteria

1. Paid invoke p95/p99 excludes Kafka ack latency.
2. Kafka outage does not cause successful paid invoke data loss.
3. Outbox hot table remains bounded under sustained load.
4. Multiple workers do not duplicate outbox delivery.
5. Gateway reports HTTP pool saturation separately from provider unhealthiness.
6. Ledger/vault reconciliation has zero unexplained delta after load.
7. Admin Analytics remains consistent across ClickHouse, gateway-admin API, and admin-front DOM.
