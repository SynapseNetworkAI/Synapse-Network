# Agent Lessons: codex-deposit-indexer-recovery-e2e

Task: Add local E2E evidence that deposits still become spendable after the deposit indexer is down and later recovers.

### Lesson: Pending deposit screenshots need database and chain evidence

- Trigger: Pending credits can look scary when the chain transaction is confirmed but the Gateway indexer is stopped.
- Root cause: UI screenshots alone cannot prove funds are safe; the durable proof is `synapse_vault_deposits`, balance bucket movement, audit rows, and replay-safe indexer behavior.
- Fix: Add a local dogfood gate that disables the indexer, creates a real on-chain deposit, proves UI stays pending, restarts the indexer, proves `pending -> available` happens exactly once, and verifies backfill can recover a chain event when the intent was missed.

- Domain: finance-deposit
- Severity: warning
- Trigger: Pending credits can look scary when the chain transaction is confirmed but the Gateway indexer is stopped.
- Root cause: UI screenshots alone cannot prove funds are safe; the durable proof is `synapse_vault_deposits`, balance bucket movement, audit rows, and replay-safe indexer behavior.
- Fix: Add a local dogfood gate that disables the indexer, creates a real on-chain deposit, proves UI stays pending, restarts the indexer, proves `pending -> available` happens exactly once, and verifies backfill can recover a chain event when the intent was missed.
- Rule: Do not mark pending deposits as spendable without a current-chain `SynapseCore` event, matching owner/amount, DB ledger evidence, and audit evidence.
- Upgrade: bugfix-docs

## Durable Upgrade

Use `npm run e2e:deposit-indexer-recovery:local` and `npm run ci:deposit-indexer-recovery-local-evidence` for changes to deposit indexer startup, backfill, local indexer env, or deposit replay protection.
