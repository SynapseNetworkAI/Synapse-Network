# Agent Lessons: codex-consumer-withdraw-rpc-error

Task: Clean up consumer withdrawal RPC failure handling.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Preserve backend error codes for localized finance UX

- Domain: frontend
- Severity: warning
- Trigger: Consumer withdrawal showed a raw nested `503` chain RPC error on the Credits page.
- Root cause: The backend wrapped `CHAIN_RPC_UNAVAILABLE` into a generic ticket-signing message, and the frontend consumer withdrawal adapter threw a plain `Error` without a stable code.
- Fix: Preserve the backend `HTTPException` code after releasing reserved funds, throw a typed frontend API error, and map known codes through i18n copy.
- Rule: Finance UIs must branch on stable backend error codes and never show raw backend or RPC internals as user-facing toast copy.
- Upgrade: bugfix-docs

### Lesson: Split new browser verifiers before the push gate

- Domain: ci
- Severity: warning
- Trigger: The first Playwright error-toast verifier exceeded the 500 effective-line budget and blocked pre-push.
- Root cause: Browser setup, Gateway mocks, case actions, assertions, and reporting were placed in one executable script.
- Fix: Split the verifier into setup/mock fixtures, case definitions, browser fixture glue, and a small runner; record legacy stop-loss baselines only for already-large touched files.
- Rule: New UI verifier scripts must be modular from the start; mocks, cases, and runner code should live in separate files so quality-budget gates stay useful.
- Upgrade: agents-memory

### Lesson: Directory regex guards must match files below the directory

- Domain: ci
- Severity: warning
- Trigger: The i18n migration diff should have used the dedicated DOM gate, but the diff coverage guard still ran ordinary frontend line coverage.
- Root cause: `USER_FRONT_I18N_REGEX` matched the literal `services/user-front/src/i18n/` path instead of files under that directory.
- Fix: Change the regex to match `services/user-front/src/i18n/.*` so i18n resource changes route to the intended DOM regression gate.
- Rule: CI path regexes for directories must include an explicit descendant matcher and should be tested with real changed file paths before relying on them.
- Upgrade: agents-memory

### Lesson: I18n schema additions may need explicit legacy size baselines

- Domain: ci
- Severity: warning
- Trigger: Adding one localized error key made `services/user-front/src/i18n/schema.ts` exceed its existing quality-budget baseline by one effective line.
- Root cause: The i18n schema is already a large typed contract file, so tiny resource additions can trip the stop-loss gate even when the product change is valid.
- Fix: Add the matching schema/resource keys, run a production build, and update the explicit quality-budget baseline only for the known legacy schema file.
- Rule: When adding i18n resource keys, verify the schema/resources together with `yarn build`; if a legacy baseline changes, keep the increase minimal and document why.
- Upgrade: agents-memory
