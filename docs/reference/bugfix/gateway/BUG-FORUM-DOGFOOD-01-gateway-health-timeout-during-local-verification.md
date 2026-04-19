# BUG-FORUM-DOGFOOD-01: gateway health timeout during local forum dogfood

## Status

Observed during local verification. The forum dogfood and DB reconciliation completed after applying a local-only startup guard.

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

## Verification

Forum dogfood DB reconciliation passed:

- Report: `output/dogfood/forum-feedback/2026-04-19T051705037Z/report.md`
- Browser/API checks: 8 passed, 0 failed, 0 warnings
- DB reconciliation for run `forum-20260419051638`: 4 feedback rows, 2 forum topics, 2 replies

## Follow-up

The durable fix should make startup background work cooperative:

- Ensure deposit indexer backfill/reconciliation yields before long loops.
- Keep `/health` responsive while background processors initialize.
- Consider exposing the blocked processor in readiness rather than blocking the event loop.

## Residual Risk

This is a local dogfood startup risk, not a forum persistence bug. It can still slow local verification until the indexer startup path is made fully cooperative.
