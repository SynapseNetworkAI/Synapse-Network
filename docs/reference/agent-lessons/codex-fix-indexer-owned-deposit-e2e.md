# Agent Lessons: codex/fix-indexer-owned-deposit-e2e

### Lesson: Release evidence must track retired money endpoints

- Domain: finance-e2e
- Severity: warning
- Trigger: Staging release evidence failed because the test still expected the retired public deposit confirm endpoint to return 200.
- Root cause: The release E2E contract was not updated when deposit confirmation became indexer-owned.
- Fix: The test now asserts `DEPOSIT_CONFIRM_INDEXER_ONLY`, triggers the protected deposit indexer for deterministic staging evidence, and polls sync/balance APIs.
- Rule: When a finance endpoint is intentionally retired, release evidence must assert the retired status and then exercise the replacement money-state transition path.
- Upgrade: bugfix-docs
