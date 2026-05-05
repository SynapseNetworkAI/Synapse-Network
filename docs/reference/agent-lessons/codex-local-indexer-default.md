# Agent Lessons: codex-local-indexer-default

Task: Enable the local Gateway deposit indexer by default so local deposits leave Pending / Syncing without manual worker commands.
Status: Active

## Push Review

### Lesson: Local startup defaults must match documented finance workers

- Domain: local-finance-runtime
- Severity: warning
- Trigger: Local Billing showed successful on-chain deposits as Pending / Syncing because `restart_gateway.sh` and `setup_local_env.sh` defaulted `V2_INDEXER_ENABLED=false` while the local docs said the Gateway starts the deposit indexer by default.
- Root cause: Script defaults drifted from the documented local runtime contract, so the API could register deposit intents but never auto-confirm them from chain receipts.
- Fix: Local Gateway startup now defaults `V2_INDEXER_ENABLED=true` while still allowing `V2_INDEXER_ENABLED=false` as an explicit override.
- Rule: Local money-path startup scripts must keep compensating workers aligned with the documented developer runtime, especially deposit indexing and balance sync.
- Upgrade: bugfix-docs

### Lesson: Local startup must enable all money-path recovery workers

- Domain: local-finance-runtime
- Severity: warning
- Trigger: A Consumer withdrawal stayed `REQUESTED` with funds in pending after the ticket expired because local Gateway was started with `CONSUMER_WITHDRAW_PROCESSOR_ENABLED=false`.
- Root cause: `restart_gateway.sh` explicitly disabled withdrawal recovery workers and local setup had a separate Gateway startup path, so `/health` passed while `/readiness` would have shown required monitors disabled.
- Fix: Local Gateway startup defaults now enable deposit indexer, backfill, reconciliation, service health monitor, Provider withdrawal reaper, Consumer withdrawal processor, in-app cleanup, service-health event cleanup, and standalone analytics/notification outbox workers.
- Rule: Local setup and restart must share one Gateway startup contract and must fail on missing `/readiness` monitors, not just pass `/health`.
- Upgrade: bugfix-docs
