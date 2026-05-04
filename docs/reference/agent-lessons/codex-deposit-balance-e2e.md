# Agent Lessons: codex-deposit-balance-e2e

Task: Add deposit balance E2E evidence and publish the frontend/docs fixes.
Status: Active

## Push Review

### Lesson: Finance E2E PRs need artifact hygiene and isolated wallets

- Domain: frontend-finance
- Severity: warning
- Trigger: Local docs build regenerated OpenAPI files, local Hardhat deploy changed contract config, and repeated deposit E2E runs made final balance screenshots show accumulated totals instead of a clean single-run `$100.00`.
- Root cause: The publish flow initially treated all dirty files and deterministic wallets as equally PR-ready, even though some files were generated local artifacts and the wallet had prior successful deposits.
- Fix: Restore generated/local-only artifacts before staging, and derive the deposit E2E consumer wallet from a run id so screenshots and SQL deltas are easy to audit.
- Rule: Money-path PRs must stage only source/evidence harness changes, and local E2E accounts should be isolated per run unless the test explicitly verifies accumulated balances.
- Upgrade: bugfix-docs
