# Agent Lessons: codex-service-health-typed-tables-e2e

Task: Add service health typed table E2E coverage.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: PR branches must carry their agent lessons file

- Domain: ci
- Severity: warning
- Trigger: PR checks failed before the product gates ran because the branch-specific agent lessons file was missing.
- Root cause: The branch was pushed without creating `docs/reference/agent-lessons/codex-service-health-typed-tables-e2e.md`.
- Fix: Add the branch-specific agent lessons file and rerun `npm run ci:agent-lessons`.
- Rule: Every non-merge PR branch must include its matching agent lessons file before push, even when there are no new product lessons.
- Upgrade: not required
