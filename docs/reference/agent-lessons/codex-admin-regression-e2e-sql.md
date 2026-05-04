# Agent Lessons: codex-admin-regression-e2e-sql

Task: Add Admin full-regression SQL, DOM, screenshot, notification, and withdrawal evidence coverage.
Status: Active

## Push Review

## Lessons

### Lesson: Local Admin regression must restore shared services after isolated withdrawal suites

- Domain: test
- Severity: warning
- Trigger: Full Admin regression ran isolated withdrawal suites that redeployed contracts and relaunched Gateway against per-run databases before notification and Admin UI checks.
- Root cause: The later Admin checks expected the normal Docker local Gateway DB and current frontends, while the isolated suites intentionally mutated local runtime state.
- Fix: Add explicit Gateway and frontend restore steps inside the Admin regression runner before notification, analytics, and final Admin UI evidence checks.
- Rule: Any aggregate E2E suite that invokes isolated financial harnesses must restore shared local services before continuing with broad control-plane checks.
- Upgrade: agents-memory

### Lesson: Screenshot evidence needs API and SQL bindings

- Domain: test
- Severity: warning
- Trigger: Admin screenshots could previously prove that a page rendered without proving the underlying control-plane state was correct.
- Root cause: Visual evidence was collected separately from API responses and database projections, so a stale or empty page could still leave a screenshot artifact.
- Fix: Add function-level evidence that records route, click surface, DOM assertion, API assertion, SQL probe, and screenshot metadata for each Admin function area.
- Rule: For finance/admin regression, screenshots are evidence only when bound to the expected DOM text and matching API/SQL state.
- Upgrade: agents-memory
