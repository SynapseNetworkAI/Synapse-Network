# BUG-FORUM-DOGFOOD-01: gateway health timeout during local forum dogfood

## Status

Fixed. The forum dogfood and DB reconciliation originally completed after applying a local-only startup guard; the gateway now isolates deposit indexer blocking work from the FastAPI event loop.

## Reproduction

1. Start the local gateway with `sh scripts/local/restart_gateway.sh`.
2. Poll `http://127.0.0.1:8000/health`.
3. In the affected run, the TCP connection opened but `/health` timed out.
4. Gateway logs showed startup tasks beginning before the API became responsive.

## Root Cause

The local gateway startup path launches background processors. The deposit indexer can run backfill and reconciliation work before yielding back to the event loop, which can make local `/health` appear hung during dogfood runs.

This did not indicate missing forum tables. The following tables already existed in local Postgres:

- `synapse_feedback_reports`
- `synapse_forum_topics`
- `synapse_forum_replies`
- `synapse_forum_reactions`

## Workaround Used For Verification

For the forum feedback dogfood run only, the gateway was started with heavy background processors disabled:

```bash
V2_BACKFILL_ENABLED=false
V2_RECONCILIATION_ENABLED=false
SERVICE_HEALTH_MONITOR_ENABLED=false
PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED=false
CONSUMER_WITHDRAW_PROCESSOR_ENABLED=false
```

After that, `/health` returned `{"status":"ok","version":"2.0.0"}` and the dogfood verification completed.

## Fix

The deposit indexer now:

- runs blocking backfill, pending intent, and reconciliation work in a dedicated single-thread executor instead of the FastAPI event loop
- applies `V2_INDEXER_STEP_TIMEOUT_SEC` around each blocking step
- refuses to queue a second step while the previous worker thread is still running
- exposes indexer heartbeat, step duration, consecutive failure, timeout, and stale status through `/readiness`
- configures Web3 HTTP request timeout through `RPC_REQUEST_TIMEOUT_SEC`
- configures PostgreSQL connection timeout through `POSTGRES_CONNECT_TIMEOUT_SEC`
- runs service health monitor ticks in a dedicated single-thread executor so provider health checks cannot block the API event loop

## Verification

Forum dogfood DB reconciliation passed:

- Report: `output/dogfood/forum-feedback/2026-04-19T051705037Z/report.md`
- Browser/API checks: 8 passed, 0 failed, 0 warnings
- DB reconciliation for run `forum-20260419051638`: 4 feedback rows, 2 forum topics, 2 replies

Focused stability regression passed:

```bash
cd services/gateway
.venv/bin/python -m pytest \
  tests/unit/test_deposit_indexer_runner_stability_unit.py \
  tests/unit/test_gateway_readiness_endpoint_unit.py \
  tests/unit/test_deposit_indexer_runtime_state_unit.py
```

Result: 11 passed.

## Follow-up

The next architectural hardening step is to move deposit indexer, withdrawal watchers, and other compensating workers into a separate gateway worker process. That is no longer required for local dogfood stability, but remains the preferred production isolation model.

## Residual Risk

This was a local dogfood startup risk, not a forum persistence bug. `/readiness` can now return degraded while `/health` stays responsive; operators should alert on degraded readiness rather than restarting the API process for every indexer timeout.
