---
created_at: 2026-04-18
updated_at: 2026-04-18
doc_status: active
---

# Local Performance Smoke Report

## Run Metadata

- Environment: local
- Commit: `29d50082`
- Run time UTC: `2026-04-18T12:51:19Z`
- Duration: `10s per suite`
- Concurrency: `2`
- Request delay: `200ms per worker`
- Evidence directory: `docs/evidence/performance/20260418T125119Z-local-smoke`

## Scope

This local smoke validates only already-running local HTTP entrypoints. It is not production-like load evidence and must not mark staging/prod load-test blockers as PASS.

Included:

1. Gateway health endpoint at `SYNAPSE_LOCAL_GATEWAY_BASE_URL`.
2. Admin-front login page at `SYNAPSE_LOCAL_ADMIN_FRONT_BASE_URL`.

Excluded:

1. Authenticated gateway invoke and finance mutations.
2. Provider health fleet load.
3. Chaos, failover, rollback, and restore drills.
4. `user-front` marketplace, because the local probe returned HTTP 500 before this run and should be handled as a separate frontend bug if needed.

## Results

| Endpoint | Requests | Success Rate | p50 | p95 | p99 | Failures |
| --- | --- | --- | --- | --- | --- | --- |
| gateway-health | 98 | 1.0000 | 1.128ms | 1.631ms | 14.818ms | 0 |
| admin-front-login | 92 | 1.0000 | 15.794ms | 28.413ms | 32.778ms | 0 |

## Raw Evidence

- Gateway summary: `gateway/summary.json`
- Gateway raw results: `gateway/raw-results.jsonl`
- Admin-front summary: `admin-front/summary.json`
- Admin-front raw results: `admin-front/raw-results.jsonl`

## Decision

- Local smoke result: PASS
- Production launch impact: NO-GO unchanged. This report does not replace staging load, chaos, rollback, restore, or monitoring evidence.
