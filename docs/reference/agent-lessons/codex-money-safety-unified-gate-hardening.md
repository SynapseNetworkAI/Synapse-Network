# Agent Lessons: codex-money-safety-unified-gate-hardening

Task: Harden unified money safety regression gates, fullchain withdrawal evidence, and local cleanup behavior.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Unified local gates must treat optional local fixtures as explicit skips, not hard failures

- Domain: e2e
- Severity: warning
- Trigger: The unified money-safety runner failed locally when `LLM_E2E_CREDENTIAL` was absent, even though the local plan allows the LLM settlement lane to be skipped when no local fixture is configured.
- Root cause: The runner treated every lane as mandatory and then consumed whichever latest evidence directory existed, instead of encoding fixture-optional behavior in the orchestration layer itself.
- Fix: Detect missing local LLM fixtures up front, record a structured skipped scenario with warning evidence, and only hydrate LLM settlement evidence when the local fixture is actually present.
- Rule: Local unified gates must distinguish required money-path lanes from optional fixture-dependent lanes; missing optional local fixtures should produce explicit skip evidence, not red builds.
- Upgrade: agents-memory

### Lesson: Long-running local E2E lanes need one canonical provider owner key and enough synthetic budget to cover every scenario

- Domain: e2e
- Severity: warning
- Trigger: `withdrawal-one-ticket-evidence` first used a provider key that did not match local Provider onboarding ownership, then later exhausted synthetic receivable, call-count, credit-limit, and QPS budget before the full provider scenario matrix finished.
- Root cause: The lane carried its own stale default provider key and under-sized harness budgets instead of inheriting the same canonical onboarding owner and scenario-sized budgets used by the local Provider stack.
- Fix: Hydrate the provider key from local onboarding config, then size agent credential limits and receivable generation loops to the full provider scenario count before starting the lane.
- Rule: Local fullchain lanes that depend on canonical provider services must reuse the same provider owner identity as onboarding and pre-compute enough synthetic budget for every scenario in the matrix.
- Upgrade: agents-memory
