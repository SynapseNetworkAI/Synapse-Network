---
created_at: 2026-04-18
updated_at: 2026-04-21
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
4. Gateway stress static review catches fake async, missing timeouts, wait-in-transaction, unbounded-read warnings, and missing hot-path indexes.
5. Smoke output is part of `ci:pr`, so release-gate regressions cannot bypass PR review.

Command:

```bash
npm run ci:performance-reliability
```

Current implementation:

```bash
bash scripts/ci/performance_reliability_checks.sh
```

Run the code-structure stress review directly when investigating launch-readiness hazards:

```bash
npm run ci:gateway-stress-review
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

## Local Reliability Suite

Use this command before staging to verify the automation bundle itself:

```bash
npm run perf:local-reliability-suite
```

The local suite is safe for developer laptops. It verifies:

1. `ci:performance-reliability` provider health concurrency, slow lane, jitter, and recovery smoke.
2. release Go/No-Go and docs gates.
3. shell syntax for performance, chaos, and recovery scripts.
4. JSON validity for all performance scenarios.
5. staging confirmation guards for load, chaos, and recovery scripts.
6. local HTTP smoke when `127.0.0.1:8000` and `127.0.0.1:4000` are available.

The local HTTP smoke is optional by default because it depends on already-running local services. To make unavailable local services a hard failure:

```bash
SYNAPSE_LOCAL_SUITE_REQUIRE_HTTP=1 npm run perf:local-reliability-suite
```

To validate only automation and safety guards without HTTP probing:

```bash
SYNAPSE_LOCAL_SUITE_SKIP_HTTP_SMOKE=1 npm run perf:local-reliability-suite
```

Evidence is written under:

```bash
docs/evidence/performance/<timestamp>-local-reliability-suite/report.md
```

This report can mark only local automation as `PASS`. It must not mark staging load, chaos, rollback, restore, or signer blockers as passed.

## Local MVP Production-Load Rehearsal

Use this command when validating local concurrency and money-state safety before a staging load run:

```bash
SYNAPSE_LOAD_PROFILE=local-mvp \
SYNAPSE_LOAD_DURATION_SEC=90 \
SYNAPSE_LOAD_DRAIN_SEC=5 \
SYNAPSE_LOAD_DRAIN_HARD_CAP_SEC=30 \
SYNAPSE_LOAD_CONSUMER_WALLET_COUNT=4 \
SYNAPSE_LOAD_PROVIDER_WALLET_COUNT=4 \
npm run perf:local-production-load-rehearsal

npm run ci:local-production-load-evidence
```

The runner is local-only. It refuses non-local Gateway, gateway-admin, RPC, or non-`31337` chain targets. By default it bootstraps the local Gateway/contracts and starts gateway-admin; set `SYNAPSE_LOAD_SKIP_LOCAL_BOOTSTRAP=1` only when those local services are already running.

The `local-mvp` defaults intentionally use conservative lane concurrency so a developer laptop validates state-machine safety rather than pretending to be staging capacity. Defaults are `invoke=1`, `balance=4`, `deposit-confirm=2`, `withdrawal=1`, `provider-health=1`, and `admin-finance=2`; staging capacity runs must override these values in a dedicated environment.

This rehearsal proves:

1. Every run has a unique `REHEARSAL_RUN_ID`.
2. Consumer/provider wallets are generated with `ethers.Wallet.createRandom()` for the current run only.
3. Private keys, mnemonics, raw signatures, JWTs, admin tokens, and cookies are never written to evidence.
4. Faucet funding is serialized from the Hardhat deployer.
5. Each wallet shard serializes its own chain writes while different wallet shards can run concurrently.
6. `nonce too low`, `replacement transaction underpriced`, and `already known` are classified as runner wallet-isolation issues, not Gateway 5xx.
7. Clean local pass requires `chainNonceCollisionCount === 0`.
8. The six MVP lanes execute: invoke, balance, deposit-confirm, withdrawal, provider-health, and admin-finance.
9. Graceful drain finishes before the hard cap and leaves no abandoned in-flight requests.
10. Ledger/vault reconciliation for this local run reports `0.000000` unexplained delta.

Evidence is written under:

```bash
docs/evidence/performance/<timestamp>-local-production-load-rehearsal/
```

Required artifacts:

1. `report.md`
2. `report.json`
3. `environment-manifest.json`
4. `contract-manifest.json`
5. `traffic-summary.json`
6. `reconciliation-summary.json`

This report is **not** staging or production capacity evidence. Local laptop p95/p99 latency is advisory only because Postgres, Redis, Anvil, Gateway, gateway-admin, the mock provider, and the load runner contend for the same machine. The hard pass/fail checks are safety checks: no unexpected 5xx, no nonce collisions, no hard-drain hang, no secret leakage, and no unexplained financial delta. Explicit overload responses such as `503 SERVICE_BUSY` are counted as expected degradation only when the lane declares them acceptable; raw `500` remains a hard failure.

Staging must not use dynamic random wallets. Staging load must use pre-approved dedicated test wallets and externally funded test balances. Production must not run destructive load; production validation is capped small-value rehearsal plus read-only reconciliation and monitoring evidence.

## Staging Load Plan

Run staging load only against a disposable staging environment with production-like configuration and isolated test wallets/providers.

These commands are manual staging commands and must not be added to `ci:pr`:

Run all load scenarios as one staging suite:

```bash
SYNAPSE_PERF_ENV=staging \
SYNAPSE_PERF_CONFIRM=I_UNDERSTAND_THIS_HITS_STAGING \
npm run perf:staging-load-suite
```

The staging load suite requires these environment variables:

1. `SYNAPSE_GATEWAY_BASE_URL`
2. `SYNAPSE_ADMIN_GATEWAY_BASE_URL`
3. `SYNAPSE_PERF_SERVICE_ID` when overriding the default. The MVP staging default is `svc_oss_security_healthcheck` because it is deterministic, low-latency, and covered by the provider staging allowlist.
4. `PROJECT_ID` or explicit staging credentials:
   `GATEWAY_E2E_OWNER_KEY`, `STAGING_ADMIN_E2E_PASSWORD`, and
   `STAGING_ADMIN_E2E_OTP_SECRET`

MVP staging defaults intentionally use `SYNAPSE_PERF_CONCURRENCY=1` and
`SYNAPSE_PERF_REQUEST_DELAY_MS=1000` so the suite validates availability and
unexpected 5xx behavior without tripping the provider staging QPS guard. Raise
these only for an explicit load rehearsal with a matching provider QPS change.

The suite obtains admin auth through the staging admin E2E account and exports a
cookie/CSRF header for admin read-only load. It also authenticates the staging
E2E consumer wallet and exports `SYNAPSE_AGENT_TOKEN`, `SYNAPSE_OWNER_TOKEN`,
and `SYNAPSE_OWNER_WALLET`. It no longer uses a bearer-only
`SYNAPSE_ADMIN_TOKEN` model. Destructive money-write concurrency is disabled
by default; enable it only with both:

```bash
SYNAPSE_PERF_ENABLE_MONEY_WRITE_LOAD=1
SYNAPSE_MONEY_CONCURRENCY_COMMAND='<explicit isolated-wallet command>'
```

Or run individual scenarios:

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
6. Transactional outbox pressure: backlog growth, oldest pending age, dead-letter count, worker drain rate, and successful-row deletion.
7. Multi-worker outbox consumption: at least three workers consume with `FOR UPDATE SKIP LOCKED` and no duplicate `event_id` delivery.
8. HTTP provider client pool saturation: `httpx.PoolTimeout` returns `SERVICE_BUSY`, does not charge the consumer, and emits Gateway capacity metrics.

Minimum report fields:

1. environment name, commit, config manifest, test data manifest
2. traffic model, duration, concurrency, and ramp profile
3. p50/p95/p99 latency per endpoint
4. success rate, timeout rate, 4xx/5xx/error-code distribution
5. DB pool usage, lock wait, deadlock, outbox backlog, queue lag, ClickHouse/Kafka lag, RPC latency
6. ledger/vault reconciliation before and after the run
7. incident or bugfix links for every failed threshold
8. provider HTTP pool wait and saturation metrics

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
| Analytics outbox | No unbounded backlog; successful rows deleted; oldest pending age explained |
| Outbox worker concurrency | `0` duplicate event ids under 3-worker `FOR UPDATE SKIP LOCKED` drain |
| HTTP client pool | Pool saturation returns `SERVICE_BUSY` before charge and is separately observable |

Gateway production performance implementation rules live in [Gateway_Production_Performance_Stability_Optimization.md](../projects/gateway/Gateway_Production_Performance_Stability_Optimization.md).

## Chaos Drill Plan

Chaos drills must prove that failures are detected, contained, audited, and recoverable.

Chaos commands are manual staging commands and require operator-provided fault and verification commands:

Run the full staging chaos suite:

```bash
SYNAPSE_CHAOS_ENV=staging \
SYNAPSE_CHAOS_CONFIRM=I_UNDERSTAND_THIS_BREAKS_STAGING \
npm run chaos:staging-suite
```

The staging chaos suite requires operator-provided fault and verification commands:

1. `SYNAPSE_CHAOS_PROVIDER_STOP_CMD`
2. `SYNAPSE_CHAOS_PROVIDER_START_CMD`
3. `SYNAPSE_CHAOS_GATEWAY_RESTART_CMD`
4. `SYNAPSE_CHAOS_GATEWAY_ADMIN_RESTART_CMD`
5. `SYNAPSE_CHAOS_ANALYTICS_STOP_CMD`
6. `SYNAPSE_CHAOS_ANALYTICS_START_CMD`
7. `SYNAPSE_CHAOS_RPC_OUTAGE_CMD`
8. `SYNAPSE_CHAOS_RPC_RECOVER_CMD`
9. `SYNAPSE_CHAOS_POSTGRES_FAILOVER_CMD`
10. `SYNAPSE_CHAOS_REDIS_STOP_CMD`
11. `SYNAPSE_CHAOS_REDIS_START_CMD`
12. `SYNAPSE_CHAOS_VERIFY_CMD`

Or run individual drills:

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
```

Required drills:

1. Provider outage: unhealthy targets drain from discovery/invoke and recover after health returns.
2. Gateway restart: in-flight idempotent operations do not double-charge or lose audit events.
3. Gateway-admin restart: high-risk admin actions remain auditable and do not mutate runtime ledger directly.
4. Analytics outbox/projection degradation: analytics degrades visibly without blocking money movement. ClickHouse/Kafka outage is a growth-stage drill only if those systems are reintroduced.
5. RPC outage or slow RPC: deposit/withdraw watchers degrade and recover without duplicate settlement.
6. Postgres failover: API returns bounded errors or recovers; no partial money mutation.
7. Postgres idempotency/row-lock fallback: durable idempotency and lock behavior remains explicit and safe without Redis in the MVP runtime.
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

Run the full staging recovery suite:

```bash
SYNAPSE_DRILL_ENV=staging \
SYNAPSE_DRILL_CONFIRM=I_UNDERSTAND_THIS_CHANGES_STAGING \
npm run drill:staging-recovery-suite
```

The staging recovery suite requires:

1. `SYNAPSE_DRILL_APP_ROLLBACK_CMD`
2. `SYNAPSE_DRILL_CONFIG_ROLLBACK_CMD`
3. `SYNAPSE_DRILL_SIGNER_ROLLBACK_CMD`
4. `SYNAPSE_DRILL_VERIFY_CMD`

Or run individual recovery drills:

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
