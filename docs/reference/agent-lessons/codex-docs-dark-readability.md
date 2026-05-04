# Agent Lessons: codex-docs-dark-readability

Task: Fix docs-front dark theme readability and add visual regression checks.
Status: Active

## Push Review

## Lessons

### Lesson: Verify localhost services come from the active workspace

- Domain: docs-front
- Severity: note
- Trigger: The first browser verifier run still saw the old light sidebar after the fix.
- Root cause: `localhost:3100` was served by a sibling checkout instead of the current branch workspace.
- Fix: Inspect the listening process and restart docs-front from the active workspace before running visual verification.
- Rule: Before using localhost visual evidence, confirm the process command or working tree matches the branch under test.
- Upgrade: none

### Lesson: Canonical provider E2E payloads must match provider schemas

- Domain: gateway-e2e
- Severity: warning
- Trigger: Pre-push full CI failed when canonical service invocation returned upstream HTTP 422.
- Root cause: E2E reused canonical provider services but still sent the old generic `prompt` payload, and then missed the Gateway `payload.body` wrapper that provider forwarding reads.
- Fix: Centralize schema-valid payload bodies for canonical service IDs and wrap them as `{"payload": {"body": ...}}` in invoke/API-reference E2E tests.
- Rule: When an E2E switches from generated test services to canonical services, the fixture must own the service ID, the schema-valid request body, and the Gateway payload envelope.
- Upgrade: none
