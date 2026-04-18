---
created_at: 2026-04-18
updated_at: 2026-04-18
doc_status: active
---

# Performance and Reliability Verification

This document is the production launch performance and reliability test plan for Synapse. It defines what can be proven by local automation, what must be proven in staging, and what remains a production Go/No-Go blocker until evidence is attached.

## Launch Rule

Performance and reliability evidence is a P0 launch gate. A local smoke test can prove scheduler invariants and regression safety, but it cannot replace production-like load, chaos, rollback, backup, or restore drills.

Production remains **NO-GO** if any required report below is missing.

## Test Tiers

| Tier | Scope | Command | Launch Meaning |
| --- | --- | --- | --- |
| Local CI smoke | Deterministic unit-level reliability guards for bounded concurrency, slow lane, jitter, and recovery semantics. | `npm run ci:performance-reliability` | Required regression signal, not production capacity evidence. |
| Staging load | Gateway, admin, and provider-facing flows under realistic traffic mix. | Environment-specific load runner. | Required production readiness evidence. |
| Staging chaos | Provider outage, gateway restart, gateway-admin restart, RPC/DB/queue/analytics outage drills. | Environment-specific chaos runbook. | Required resilience evidence. |
| Recovery drill | App rollback, config rollback, feature flag shutoff, provider drain, signer rollback, backup restore. | Environment-specific recovery runbook. | Required recovery evidence. |

## Local CI Smoke

Local CI smoke must stay fast, deterministic, and safe for developer laptops. It verifies algorithms and safety rails rather than absolute throughput.

Required checks:

1. Provider health probe burst respects `SERVICE_HEALTH_MAX_CONCURRENCY`.
2. Long-unhealthy active services enter slow lane and avoid normal-frequency probing.
3. Skipped slow-lane services remain visible as tracked health state and are not silently dropped.
4. Smoke output is part of `ci:pr`, so release-gate regressions cannot bypass PR review.

Command:

```bash
npm run ci:performance-reliability
```

Current implementation:

```bash
bash scripts/ci/performance_reliability_checks.sh
```

## Local Manual Smoke

Use this command for a local HTTP smoke against already-running local services. It is intentionally not part of CI and refuses non-local URLs.

```bash
npm run perf:local-smoke
```

Defaults:

1. Gateway: `http://127.0.0.1:8000`
2. Admin-front: `http://127.0.0.1:4000`
3. Duration: `10s`
4. Concurrency: `2`
5. Request delay: `200ms` per worker

Override with local-only URLs:

```bash
SYNAPSE_LOCAL_GATEWAY_BASE_URL=http://127.0.0.1:8000 \
SYNAPSE_LOCAL_ADMIN_FRONT_BASE_URL=http://127.0.0.1:4000 \
SYNAPSE_PERF_DURATION_SEC=30 \
SYNAPSE_PERF_CONCURRENCY=16 \
npm run perf:local-smoke
```

## Staging Load Plan

Run staging load only against a disposable staging environment with production-like configuration and isolated test wallets/providers.

These commands are manual staging commands and must not be added to `ci:pr`:

```bash
SYNAPSE_PERF_ENV=staging \
SYNAPSE_PERF_CONFIRM=I_UNDERSTAND_THIS_HITS_STAGING \
npm run perf:gateway-load

SYNAPSE_PERF_ENV=staging \
SYNAPSE_PERF_CONFIRM=I_UNDERSTAND_THIS_HITS_STAGING \
npm run perf:finance-load

SYNAPSE_PERF_ENV=staging \
SYNAPSE_PERF_CONFIRM=I_UNDERSTAND_THIS_HITS_STAGING \
npm run perf:provider-health-load

SYNAPSE_PERF_ENV=staging \
SYNAPSE_PERF_CONFIRM=I_UNDERSTAND_THIS_HITS_STAGING \
npm run perf:admin-load

SYNAPSE_PERF_ENV=staging \
SYNAPSE_PERF_CONFIRM=I_UNDERSTAND_THIS_HITS_STAGING \
npm run perf:money-concurrency
```

Required scenarios:

1. Discovery, quote, and invoke flow.
2. Balance read, deposit intent, deposit confirmation, consumer withdrawal intent, and provider withdrawal intent.
3. Provider health probes with mixed healthy, degraded, unhealthy, slow-lane, inactive, suspended, and deleted services.
4. Admin analytics overview, risk-health, money-flow, provider-revenue, finance overview, reconciliation, and provider-services pages.
5. High-concurrency money boundary tests: low balance, repeated idempotency key, duplicate request id, multiple agents for one owner, provider timeout, and database lock contention.

Minimum report fields:

1. environment name, commit, config manifest, test data manifest
2. traffic model, duration, concurrency, and ramp profile
3. p50/p95/p99 latency per endpoint
4. success rate, timeout rate, 4xx/5xx/error-code distribution
5. DB pool usage, lock wait, deadlock, queue lag, ClickHouse/Kafka lag, RPC latency
6. ledger/vault reconciliation before and after the run
7. incident or bugfix links for every failed threshold

Default staging thresholds:

| Area | P0 Threshold |
| --- | --- |
| Gateway invoke success rate | `>= 99.5%` excluding deliberate provider failures |
| Gateway invoke p95 | `<= 1500ms` excluding provider compute time |
| Discovery p95 | `<= 500ms` |
| Balance p95 | `<= 500ms` |
| Finance mutation error rate | `0 unexpected 5xx` |
| Provider health monitor | No unbounded queue growth; checked/scheduled stats stay explainable by jitter and slow lane |
| Ledger/vault reconciliation | `0` unexplained delta |

## Chaos Drill Plan

Chaos drills must prove that failures are detected, contained, audited, and recoverable.

Chaos commands are manual staging commands and require operator-provided fault and verification commands:

```bash
SYNAPSE_CHAOS_ENV=staging \
SYNAPSE_CHAOS_CONFIRM=I_UNDERSTAND_THIS_BREAKS_STAGING \
npm run chaos:provider-outage

SYNAPSE_CHAOS_ENV=staging \
SYNAPSE_CHAOS_CONFIRM=I_UNDERSTAND_THIS_BREAKS_STAGING \
npm run chaos:gateway-restart

SYNAPSE_CHAOS_ENV=staging \
SYNAPSE_CHAOS_CONFIRM=I_UNDERSTAND_THIS_BREAKS_STAGING \
npm run chaos:gateway-admin-restart

SYNAPSE_CHAOS_ENV=staging \
SYNAPSE_CHAOS_CONFIRM=I_UNDERSTAND_THIS_BREAKS_STAGING \
npm run chaos:analytics-outage

SYNAPSE_CHAOS_ENV=staging \
SYNAPSE_CHAOS_CONFIRM=I_UNDERSTAND_THIS_BREAKS_STAGING \
npm run chaos:rpc-outage

SYNAPSE_CHAOS_ENV=staging \
SYNAPSE_CHAOS_CONFIRM=I_UNDERSTAND_THIS_BREAKS_STAGING \
npm run chaos:postgres-failover

SYNAPSE_CHAOS_ENV=staging \
SYNAPSE_CHAOS_CONFIRM=I_UNDERSTAND_THIS_BREAKS_STAGING \
npm run chaos:redis-unavailable
```

Required drills:

1. Provider outage: unhealthy targets drain from discovery/invoke and recover after health returns.
2. Gateway restart: in-flight idempotent operations do not double-charge or lose audit events.
3. Gateway-admin restart: high-risk admin actions remain auditable and do not mutate runtime ledger directly.
4. ClickHouse/Kafka outage: analytics degrades visibly without blocking money movement.
5. RPC outage or slow RPC: deposit/withdraw watchers degrade and recover without duplicate settlement.
6. Postgres failover: API returns bounded errors or recovers; no partial money mutation.
7. Redis unavailable: rate limit/idempotency fallback behavior is explicit and safe.
8. Stale health: stale provider health cannot make a service callable.

Every chaos drill must attach the alert fired, dashboard screenshot or link, log excerpt, recovery action, and post-drill reconciliation.

## Rollback and Recovery Plan

Required rollback and recovery evidence:

1. app rollback command and successful rollback report
2. config rollback command and successful rollback report
3. feature flag shutoff for risky runtime paths
4. provider drain and resume procedure
5. signer rollback procedure
6. backup restore drill report
7. chain-log replay or reconciliation drill

Rollback is not considered proven until the system has passed post-rollback smoke and ledger/vault reconciliation.

Rollback commands are manual staging commands and require operator-provided rollback and verification commands:

```bash
SYNAPSE_DRILL_ENV=staging \
SYNAPSE_DRILL_CONFIRM=I_UNDERSTAND_THIS_CHANGES_STAGING \
npm run drill:application-rollback

SYNAPSE_DRILL_ENV=staging \
SYNAPSE_DRILL_CONFIRM=I_UNDERSTAND_THIS_CHANGES_STAGING \
npm run drill:config-rollback

SYNAPSE_DRILL_ENV=staging \
SYNAPSE_DRILL_CONFIRM=I_UNDERSTAND_THIS_CHANGES_STAGING \
npm run drill:signer-rollback
```

## Evidence Mapping

Update `docs/plans/production-go-live-security-verification/validation.md` after every run.

Evidence rules:

1. `npm run ci:performance-reliability` may mark only local smoke evidence as `PASS`.
2. Load test blockers remain `NO-GO blocker` until staging/prod-like load reports are attached.
3. Chaos drill blockers remain `NO-GO blocker` until drill reports and alert evidence are attached.
4. Rollback and restore blockers remain `NO-GO blocker` until recovery reports are attached.
5. Any failed threshold must create a bugfix record under `docs/reference/bugfix/` before the run can be retried.
