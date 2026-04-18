---
created_at: 2026-04-18
updated_at: 2026-04-18
doc_status: active
---

# Local Performance Smoke Report

## Run Metadata

- Environment: local
- Commit: `a40dcc59`
- Run time UTC: `2026-04-18T13:03:41Z`
- Duration: `10s per suite`
- Concurrency: `2`
- Request delay: `200ms per worker`
- Evidence directory: `docs/evidence/performance/20260418T130340Z-local-reliability-suite/local-smoke`

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
| gateway-health | 64 | 1.0000 | 1.105ms | 5.006ms | 3467.186ms | 0 |
| admin-front-login | 92 | 1.0000 | 15.553ms | 28.803ms | 36.087ms | 0 |

## Raw Evidence

- Gateway summary: `gateway/summary.json`
- Gateway raw results: `gateway/raw-results.jsonl`
- Admin-front summary: `admin-front/summary.json`
- Admin-front raw results: `admin-front/raw-results.jsonl`

## Decision

- Local smoke result: PASS
- Production launch impact: NO-GO unchanged. This report does not replace staging load, chaos, rollback, restore, or monitoring evidence.
