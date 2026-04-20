---
id: bug-admin-analytics-10k-local-load-redis-blocker
title: Admin Analytics 10k local load is throttled by downstream adaptive concurrency when Redis is unavailable
status: open
created_at: 2026-04-20
updated_at: 2026-04-20
owner: gateway
---

# BUG-ADMIN-ANALYTICS-10K-LOCAL-LOAD-REDIS-BLOCKER

## Reproduction

Run the 10,000-call Admin Analytics load dogfood against the local Gateway profile without Redis:

```bash
redis-cli ping

ADMIN_ANALYTICS_LOAD_TOTAL=10000 \
ADMIN_ANALYTICS_LOAD_CONCURRENCY=12 \
ADMIN_ANALYTICS_LOAD_PER_SERVICE_CONCURRENCY=4 \
ADMIN_ANALYTICS_LOAD_FORCE_PROBE_KEEPALIVE_SEC=15 \
GATEWAY_BASE_URL=http://127.0.0.1:8000 \
ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 \
npm run e2e:admin-analytics-10k:fullchain
```

The local Redis probe returned connection refused, and the load run produced repeated `SERVICE_BUSY` responses from `/api/v1/agent/invoke`. Lowering per-service concurrency to `1` avoids most busy responses, but makes the 10,000-call run too slow for normal local dogfood.

## Root Cause

The Gateway downstream adaptive concurrency guard is correctly protecting provider targets before billing. In this local environment Redis is not available, so the guard falls back to a conservative local limiter. With three services and local provider health/runtime churn, the 10k load generator can outpace available downstream permits and receives `SERVICE_BUSY`.

This is not an Analytics aggregation correctness failure. A smaller 30-call fullchain run completed successfully, imported real Gateway-emitted local analytics fallback events into ClickHouse, and reconciled ClickHouse, gateway-admin API, and admin-front UI.

## Current Verification

The 30-call smoke run completed:

```bash
ADMIN_ANALYTICS_LOAD_TOTAL=30 \
ADMIN_ANALYTICS_LOAD_CONCURRENCY=12 \
ADMIN_ANALYTICS_LOAD_PER_SERVICE_CONCURRENCY=4 \
ADMIN_ANALYTICS_LOAD_FORCE_PROBE_KEEPALIVE_SEC=15 \
ADMIN_ANALYTICS_LOAD_BUSY_RETRIES=40 \
GATEWAY_BASE_URL=http://127.0.0.1:8000 \
ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 \
npm run e2e:admin-analytics-10k:fullchain

ADMIN_ANALYTICS_LOAD_FIXTURE=output/analytics-load/aal-20260420025537/fixture.json \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 \
npm run e2e:admin-analytics-10k:reconcile

ADMIN_ANALYTICS_LOAD_FIXTURE=output/analytics-load/aal-20260420025537/fixture.json \
ADMIN_ANALYTICS_LOAD_REPORT=output/analytics-load/aal-20260420025537/report.json \
ADMIN_FRONT_URL=http://127.0.0.1:4000 \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
npm run e2e:admin-analytics-10k:dogfood
```

Results:

- Fullchain smoke: 30 successful invokes.
- Reconcile: ClickHouse/API/receipt checks passed.
- Browser dogfood: `37 passed, 0 failed`.

An attempted local Redis enablement was also checked:

```bash
docker-compose -f infra/docker/local/docker-compose.yml up -d redis
redis-cli ping
REDIS_URL=redis://127.0.0.1:6379/0 sh scripts/local/restart_gateway.sh
```

Redis returned `PONG`, but the Gateway process exited shortly after startup in this local profile without producing a Python stack trace in `services/gateway/logs/provider_api.log`. The Gateway was restored with the normal local restart command. This keeps the 10k local run as an open blocker rather than a passed verification.

## Required Fix Before Claiming Full Local 10k Pass

- Make the local/staging dogfood profile start Redis and keep Gateway alive with `REDIS_URL` configured, or explicitly configure the downstream adaptive limiter for a higher deterministic local test budget.
- Re-run the exact 10,000-call command.
- Attach the 10k fixture, reconcile report, browser dogfood report, and screenshots.

## Residual Risk

Until Redis or a deterministic local limiter profile is available, the local workstation cannot honestly claim a full 10,000-call pass. The implemented scripts and docs are ready for staging, where Redis and the intended adaptive concurrency configuration should be present.
