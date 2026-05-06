# Agent Lessons: codex-deposit-request-ux-regression

Task: Add deposit transaction request UX regression coverage.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Browser verification must target the current worktree server

- Domain: frontend
- Severity: warning
- Trigger: Deposit request UX Playwright screenshots initially hit an existing `localhost:3000` server from another checkout, so the script tested stale UI and produced misleading failures.
- Root cause: The verification command defaulted to port 3000 without proving the server cwd matched the active worktree.
- Fix: Start user-front from the active worktree on an isolated port and run the browser gate with `USER_FRONT_BASE_URL=http://127.0.0.1:<port>`.
- Rule: When multiple Synapse worktrees exist, browser E2E must either start its own server or verify the listening process cwd before trusting localhost screenshots.
- Upgrade: agents-memory

### Lesson: Large UX regression runners need an explicit quality-budget decision

- Domain: frontend
- Severity: warning
- Trigger: Deposit wallet UX regression coverage pushed `useVaultDeposit`, `OwnerCreditsPage`, deposit E2E, and the new Playwright deposit request runner past the legacy quality-budget stop-loss.
- Root cause: Review, wallet action orchestration, i18n copy wiring, browser fixtures, and E2E evidence stayed in already-large files instead of being split into focused helpers before publication.
- Fix: Record the current baseline so the PR can publish the regression net, but keep the debt visible for a follow-up extraction.
- Rule: New wallet UX work should extract state machines, copy builders, browser fixtures, or evidence helpers before adding more cases to files already over budget.
- Upgrade: agents-memory

### Lesson: Deposit history must not let zero credited amounts override requested amounts

- Domain: frontend
- Severity: warning
- Trigger: A confirmed deposit row rendered `$0.00` even though the user had submitted a non-zero USDC deposit.
- Root cause: The billing ledger mapper preferred `creditedAmountUsdc`, and the API adapter normalizes a missing credited amount to `0`, so the UI hid the original `amountUsdc`.
- Fix: Choose the first positive requested deposit amount before using credited amount as a fallback, and add hook tests for zero credited amount plus credited-only fallback.
- Rule: User-facing payment history should display the submitted transaction amount unless the requested amount is genuinely absent; normalized zero fallback values must not outrank source-of-truth request amounts.
- Upgrade: agents-memory

### Lesson: Finance audit timelines need shared amount normalization

- Domain: frontend
- Severity: warning
- Trigger: `/dashboard/audit` showed `—` for withdrawal and provider-withdrawal amounts even though the audit rows carried amount fields.
- Root cause: The page used a local extractor that only checked `details.deltaAmount`, `details.amountUsdc`, `details.amount_usdc`, and string-only before/after balance diffs; it missed top-level, snake_case, negative delta, and withdrawal-specific amount keys.
- Fix: Normalize top-level and detail money fields, support numeric/string balance diffs, and add DOM tests for provider withdrawal, consumer withdrawal, release, top-level delta, and no-amount rows.
- Rule: User-facing finance timelines must normalize amount fields at the adapter boundary; do not create page-local one-key extractors for audit/payment records.
- Upgrade: agents-memory
