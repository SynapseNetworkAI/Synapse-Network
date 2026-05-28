# Agent Lessons: codex-finance-deposit-withdraw-hardening

Task: Harden deposit and withdrawal chain evidence before staging/prod release.
Status: Active

## Push Review

### Lesson: Money movement must be proven by server-owned chain evidence

- Domain: finance-backend
- Severity: critical
- Trigger: Review found public owner-authenticated deposit confirmation and withdrawal completion paths that could trust client-provided event keys, confirmation counts, or tx hashes too early.
- Root cause: Chain evidence validation was split across public API and runtime helpers instead of centralized server-owned receipt and event checks.
- Fix: Deposit confirmation is indexer-owned, and withdrawal completion verifies receipt status, target contract, and matching withdrawal event before moving balances.
- Rule: Public routes must never accept client-supplied chain metadata as sufficient proof to credit, release, or settle funds.
- Upgrade: finance-instructions

### Lesson: Token decimals are contract data, not constants

- Domain: finance-frontend
- Severity: critical
- Trigger: USDC conversion paths still assumed 18 decimals even though production Arbitrum One USDC uses 6 decimals.
- Root cause: Test/local MockUSDC assumptions leaked into Gateway and wallet UI amount conversion.
- Fix: Gateway and user-front now read the configured token `decimals()` before converting display money to atomic units.
- Rule: Finance code must read token decimals from the configured contract or verified config; never hardcode USDC atomic precision in live money paths.
- Upgrade: finance-instructions
