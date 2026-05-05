# BUG: Local withdrawal reapers disabled by startup scripts

## Summary

Local Gateway could return `/health` while withdrawal recovery workers were disabled. A Consumer withdrawal with an expired ticket stayed `REQUESTED` and kept funds in `pending_balance` because `CONSUMER_WITHDRAW_PROCESSOR_ENABLED=false` was injected by `scripts/local/restart_gateway.sh`.

## Root Cause

`restart_gateway.sh` explicitly defaulted several local background tasks to disabled:

- `V2_BACKFILL_ENABLED=false`
- `V2_RECONCILIATION_ENABLED=false`
- `PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED=false`
- `CONSUMER_WITHDRAW_PROCESSOR_ENABLED=false`

`setup_local_env.sh` also had a separate Gateway startup path, so full setup and Gateway-only restart could drift.

## Fix

- Local Gateway restart now defaults all in-process runtime monitors to enabled.
- Local restart validates `/readiness`, not only `/health`.
- Local restart starts `analytics-outbox` and `notification-outbox` workers.
- Full local setup delegates Gateway startup to `restart_gateway.sh`.
- `stop_local_env.sh` stops outbox worker PIDs and screen sessions.
- `local_runtime_guard_scan.sh` blocks regressions that disable local monitors or remove worker startup.

## Verification

- `bash -n scripts/local/restart_gateway.sh scripts/local/setup_local_env.sh scripts/local/stop_local_env.sh`
- `bash scripts/ci/local_runtime_guard_scan.sh`
- `npm run ci:docs`
- `git diff --check`

## Operator Note

Local notification outbox worker is enabled by default and will use `.env.local` Gmail SMTP / Lark settings if configured. Clear those credentials or disable notification config before local runs that must not send external messages.
