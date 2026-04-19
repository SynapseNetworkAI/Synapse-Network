---
created_at: 2026-04-19
updated_at: 2026-04-19
doc_status: active
---

# Gateway Pre-Launch Stress Review

This document turns the pre-launch reliability checklist into executable review constraints for Synapse Gateway. It is written for agents and human reviewers who need to find resource exhaustion, deadlocks, event-loop blocking, and cascading failure risks before production launch.

This review is a **P0 launch gate**. It does not replace staging load tests, chaos drills, rollback drills, or production monitoring evidence. It prevents the codebase from shipping known structural hazards before those heavier tests run.

## Launch Rule

Production is **NO-GO** if any `ERROR` from the static stress scan remains unresolved, or if any dynamic validation below fails without a bugfix record and rerun evidence.

Advisory `WARN` findings do not automatically block local development, but production sign-off must either fix them or attach evidence proving the code path is bounded, indexed, and safe under the staging data volume.

## Command

Run the fast static review:

```bash
npm run ci:gateway-stress-review
```

Implementation:

```bash
bash scripts/ci/gateway_stress_review_checks.sh
```

The scanner currently checks `services/gateway/src` and verifies:

1. external HTTP/RPC calls have explicit timeouts
2. Web3 `HTTPProvider` uses `request_kwargs.timeout`
3. Postgres connects use `connect_timeout`
4. synchronous external I/O does not run directly inside `async def`
5. external I/O is not performed inside DB transactions
6. obvious unbounded materialization points are reported as warnings
7. required hot-path indexes exist in the gateway bootstrap schema

To run a broader manual audit over scripts:

```bash
python3 scripts/ci/gateway_stress_review_scan.py services/gateway/src services/gateway/scripts scripts
```

Use `--warnings-as-errors` only for dedicated cleanup branches:

```bash
python3 scripts/ci/gateway_stress_review_scan.py --warnings-as-errors
```

## Dimension 1: Event Loop Hijack and Fake Async

### Risk

FastAPI remains responsive only if the main asyncio event loop is not occupied by synchronous RPC, database scans, or CPU-heavy parsing. A background task started with `asyncio.create_task()` can still hijack the whole gateway if its body runs blocking code.

Known dangerous pattern:

```python
async def run_worker():
    web3.eth.get_logs(...)  # blocking RPC on the event loop
```

Required pattern:

```python
async def run_worker():
    await run_dedicated_executor_step(...)
```

### Static Constraints

The scanner reports `SYNC_IO_IN_ASYNC` when an `async def` contains synchronous external I/O patterns without executor isolation.

Hard rules:

1. Background workers must never run synchronous Web3, `requests`, `urllib`, or CPU-heavy batch parsing directly on the event loop.
2. Dedicated executors are preferred over the default global thread pool for chain indexers and reconciliation jobs.
3. `asyncio.wait_for()` is only an event-loop guard. It does not kill the underlying thread. The underlying RPC/DB call must also have a real timeout.

### Dynamic Verification

Required test shape:

1. Force a deposit indexer backfill or reconciliation step to block for 100 seconds.
2. Fire 100 concurrent `/health` requests while the worker is blocked.
3. Pass only if `/health` p99 stays below `50ms` in the target environment.
4. `/readiness` may degrade, but `/health` must not hang.

Local regression coverage:

```bash
cd services/gateway
.venv/bin/python -m pytest tests/unit/test_deposit_indexer_runner_stability_unit.py
```

## Dimension 2: Database Connection Exhaustion and Long Transactions

### Risk

Connection pools fail catastrophically when long-running transactions wait for external systems. The worst pattern is opening a DB transaction, then waiting on chain RPC or provider HTTP before committing.

Forbidden shape:

```python
with storage.uow.tx_cursor() as cur:
    receipt = web3.eth.wait_for_transaction_receipt(tx_hash)
    cur.execute(...)
```

Required shape:

```python
receipt = fetch_chain_receipt_with_timeout(tx_hash)
with storage.uow.tx_cursor() as cur:
    cur.execute(...)
```

### Static Constraints

The scanner reports `WAIT_IN_TRANSACTION` when a transaction block contains external network I/O.

Hard rules:

1. External API/RPC calls must happen before opening a write transaction.
2. Write transactions must be short and deterministic.
3. Every DB connection must have a connect timeout.
4. Every money mutation must remain idempotent and audited.

### Dynamic Verification

Required test shape:

1. Mock Web3 or provider RPC to delay for 10 seconds.
2. Fire 20 concurrent deposit or settlement requests.
3. Query `pg_stat_activity`.
4. Fail if any connection is `idle in transaction` for more than 5 seconds.

Suggested query:

```sql
SELECT pid, state, now() - xact_start AS xact_age, query
FROM pg_stat_activity
WHERE datname = current_database()
  AND state = 'idle in transaction'
  AND now() - xact_start > interval '5 seconds';
```

## Dimension 3: Missing Timeouts and Cascading Failures

### Risk

Slow RPC nodes, analytics backends, webhooks, or provider endpoints can consume every thread, coroutine, connection, and queue if calls lack explicit timeouts.

### Static Constraints

The scanner reports:

1. `NETWORK_TIMEOUT_MISSING`
2. `RPC_TIMEOUT_MISSING`
3. `DB_CONNECT_TIMEOUT_MISSING`

Hard rules:

1. `requests`, `urllib`, `httpx`, Web3, and Postgres connects must all use explicit timeouts.
2. Retry policies must use bounded attempts, exponential backoff, and jitter.
3. Force-probe, watcher, indexer, and analytics calls must degrade visibly instead of blocking unrelated APIs.

### Dynamic Verification

Required blackhole test:

1. Point RPC to a server that accepts connections but never returns data.
2. Start gateway.
3. Call `/health`, `/readiness`, and a low-risk API such as `/api/v1/forum/topics`.
4. Pass only if external calls fail within their configured timeout and `/health` stays responsive.

## Dimension 4: OOM and Unbounded Memory

### Risk

Queries without limits and module-level dictionaries without TTL can behave normally with small local data, then OOM under production volume.

### Static Constraints

The scanner reports advisory warnings:

1. `POTENTIAL_UNBOUNDED_READ`
2. `POTENTIAL_UNBOUNDED_CACHE`

Warnings are intentionally not hard failures because some code paths are bounded by business invariants, such as replies for one topic or tiny config tables. Before production sign-off, each warning must be resolved in one of three ways:

1. add `LIMIT`, cursor iteration, or pagination
2. add TTL/pruning or Redis-backed production storage
3. attach written evidence that the table/cardinality is bounded and indexed

### Dynamic Verification

Required memory test shape:

1. Insert 500,000 synthetic rows into high-growth tables such as deposit intents, audit events, invocations, and forum topics.
2. Run reconciliation, list, and export paths.
3. Monitor RSS with `memory_profiler`, `ps`, or container memory metrics.
4. Fail if memory grows linearly with row count or does not return to baseline after the job completes.

## Dimension 5: Slow Queries and Missing Indexes

### Risk

The gateway can pass all functional tests and still fail after weeks of data growth if hot reads require sequential scans.

### Static Constraints

The scanner verifies required index names in `infra/postgres/init/gateway/001_synapse_schema.sql` for known hot tables:

1. invocations by service and time
2. ledger entries by reference
3. deposits and withdrawals by owner and time
4. feedback by route/owner and time
5. forum topics/replies by category/activity/topic

### Dynamic Verification

Required SQL verification:

1. Seed at least 500,000 synthetic rows in target tables.
2. Capture SQL emitted by hot APIs.
3. Run `EXPLAIN ANALYZE`.
4. Fail if a hot query uses `Seq Scan` and takes more than `50ms` under staging hardware.

Example:

```sql
EXPLAIN ANALYZE
SELECT invocation_id, service_id, created_at
FROM synapse_invocations
WHERE service_id = 'svc_example'
ORDER BY created_at DESC
LIMIT 50;
```

## Bugfix Protocol

Every failed stress review must create a bugfix record before the fix is merged:

1. Gateway runtime: `docs/reference/bugfix/gateway/BUG-STRESS-XX-*.md`
2. Scripts or CI: `docs/reference/bugfix/scripts/BUG-STRESS-XX-*.md`
3. Frontend-only verification gaps: `docs/reference/bugfix/frontend/BUG-STRESS-XX-*.md`

Bugfix records must include:

1. reproduction
2. root cause
3. fix
4. verification command
5. residual risk

## Production Pass Criteria

Production launch may proceed only when all of these are true:

1. `npm run ci:gateway-stress-review` returns `errors=0`.
2. All `WARN` findings are fixed or explicitly justified with evidence.
3. Dynamic event-loop, DB transaction, blackhole timeout, memory, and EXPLAIN validations have reports attached.
4. Related Go/No-Go evidence is updated in `docs/plans/production-go-live-security-verification/validation.md`.
5. No launch owner accepts “we reviewed it manually” as a substitute for command output, logs, screenshots, or DB evidence.
