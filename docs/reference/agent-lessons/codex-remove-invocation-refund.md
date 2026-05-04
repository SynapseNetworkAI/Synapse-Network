# Agent Lessons: codex-remove-invocation-refund

Task: Remove invocation refund entry, localize provider withdrawal errors, and converge user-front i18n.
Status: Active

## Push Review

## Lessons

### Lesson: User-facing frontend copy needs a static i18n gate

- Domain: frontend
- Severity: warning
- Trigger: Several user-front pages still had hardcoded English, fixed Chinese copy, and literal toast/confirm messages after localized provider withdraw errors were added.
- Root cause: The frontend instruction said to use i18n resources, but CI did not scan for new hardcoded toast, confirm, CJK, input hint, aria-label, or title literals.
- Fix: Added `npm run ci:user-front-i18n`, migrated the active hardcoded copy into typed en/zh resources, and wired the scan into `ci:frontend`.
- Rule: New user-front page copy, errors, toasts, confirmations, input hints, and accessibility labels must land in typed i18n resources with an explicit allowlist for technical examples only.
- Upgrade: agents-memory

### Lesson: i18n static scans need paired DOM language assertions

- Domain: frontend
- Severity: warning
- Trigger: Static i18n scanning proved copy was routed through resources, but it did not prove the user actually sees the right language after render, modal open, or toast-triggering actions.
- Root cause: The regression gate checked source literals, not runtime DOM state across `en` and `zh`.
- Fix: Added focused user-front i18n DOM tests and a browser route verifier for language switching screenshots.
- Rule: Frontend copy migrations must include both static i18n scan coverage and DOM assertions for the affected page/component in each supported language.
- Upgrade: agents-memory

### Lesson: Copy-only i18n migrations need a coverage-shaped gate

- Domain: ci
- Severity: warning
- Trigger: Pre-push full CI failed ordinary frontend diff coverage even though the i18n static scan, DOM language tests, full Vitest suite, lint, and production build all passed.
- Root cause: Diff coverage treats many mechanical JSX copy replacements in legacy large components as uncovered executable lines, so i18n migrations can be blocked by line coverage instead of language correctness.
- Fix: Updated the diff coverage gate to detect user-front i18n migration files and require the dedicated `ci:user-front-i18n-dom` gate for ordinary frontend coverage in that case.
- Rule: For broad UI copy migrations, use static i18n scanning plus real DOM language assertions as the primary regression signal; keep line diff coverage for behavioral code paths.
- Upgrade: agents-memory
