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
