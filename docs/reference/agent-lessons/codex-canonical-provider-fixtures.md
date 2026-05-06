# Agent Lessons: codex-canonical-provider-fixtures

Task: Move finance E2E scripts to canonical provider catalog fixtures.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: E2E service creation guards must match helper call shapes

- Domain: e2e
- Severity: warning
- Trigger: Admin withdrawal approval and one-ticket evidence scripts could still register `awa_provider_withdraw_*` / `wot_provider_*` services after ordinary E2E was moved to canonical provider fixtures.
- Root cause: The guard blocked obvious direct route strings but missed the real helper shape, `api("/v1/services", { method: "POST" })`, used by finance evidence scripts.
- Fix: Move those scripts to canonical service discovery/invoke and add guard tests for helper-based service creation calls and historical service prefixes.
- Rule: Every banned E2E mutation pattern must have a unit test using the exact helper syntax found in scripts, not only raw HTTP examples.
- Upgrade: agents-memory
