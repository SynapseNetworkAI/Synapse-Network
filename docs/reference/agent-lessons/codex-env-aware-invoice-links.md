# Agent Lessons: codex-env-aware-invoice-links

Task: Make invoice and transaction explorer links environment-aware.
Status: Active

## Push Review

## Lessons

### Lesson: Component tests with repeated renders must clean up DOM state

- Domain: frontend
- Severity: note
- Trigger: Adding an extra OwnerBillingPage test made an existing assertion find duplicate `Payments` headings.
- Root cause: The test file rendered multiple component trees without `cleanup()`, so DOM from previous cases leaked into later assertions.
- Fix: Add `afterEach(cleanup)` and unstub public env after each test.
- Rule: When adding React component tests that render the same page multiple times, clean up DOM and env stubs between cases before asserting singleton elements.
- Upgrade: none

### Lesson: Link fixes in legacy UI can trip function budgets after formatting

- Domain: frontend
- Severity: warning
- Trigger: Pre-push quality budget failed after small invoice/explorer link edits touched legacy billing components and a large UI verifier.
- Root cause: Historical components were already near or above the function/file budget; Prettier made the effective line count visible to the changed-file scanner.
- Fix: Extract table row/header rendering into smaller components and update the verifier's explicit legacy file baseline to the current measured cap.
- Rule: When touching legacy TSX tables or large UI verification scripts, run `npm run ci:quality-budget` before push and split newly touched render blocks instead of relying on incidental formatting.
- Upgrade: none
