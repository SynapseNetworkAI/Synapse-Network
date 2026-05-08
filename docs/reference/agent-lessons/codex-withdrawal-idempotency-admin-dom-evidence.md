# Agent Lessons: codex/withdrawal-idempotency-admin-dom-evidence

Task: Harden withdrawal idempotency evidence and Admin approval DOM evidence.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: keep withdrawal evidence keys aligned with the schema

- Domain: finance-backend
- Severity: warning
- Trigger: Adding SQL evidence for withdrawal complete idempotency and txHash replay.
- Root cause: The E2E initially assumed `synapse_withdraw_tx_dedup` had a `withdrawal_id` column, but the actual uniqueness boundary is `owner_address + tx_hash + kind`.
- Fix: Query the real DB unique key and include the business `withdrawalId` in the generated evidence report.
- Rule: Withdrawal evidence must follow the actual database uniqueness key while still carrying the business order ID for traceability.
- Upgrade: not required

### Lesson: reset local E2E posture after isolated money-path runs

- Domain: e2e
- Severity: warning
- Trigger: Running Admin approval dogfood after `e2e:withdrawal-idempotency-concurrency`.
- Root cause: The idempotency suite starts Gateway with an isolated DB and redeploys contracts, which can leave the standard local Admin approval seed pointed at mismatched DB/runtime state.
- Fix: Restart Gateway back to the default local DB, ensure the canonical Provider runtime is listening, and set the manual-review threshold only for the focused Admin approval run.
- Rule: Money-path E2E suites that mutate local runtime posture must be followed by an explicit local reset before running cross-surface Admin dogfood.
- Upgrade: not required
