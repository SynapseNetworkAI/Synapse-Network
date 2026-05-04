# Agent Lessons: codex-remove-legacy-gateway-generate

Task: Remove the legacy generate endpoint and standardize agent invocation scripts.
Status: Active

## Push Review

### Lesson: Removing runtime API routes must include script and docs scans

- Domain: gateway-runtime
- Severity: warning
- Trigger: The legacy generate endpoint existed in the router, service layer, scripts, docs, and drift guards.
- Root cause: Runtime invocation behavior had migrated to discovery plus agent invoke, but old examples and E2E helpers still encoded the removed path.
- Fix: Remove the route, migrate scripts to agent invoke, update docs, and add a CI scan for removed endpoint references.
- Rule: Backward-incompatible runtime API removals must update live scripts/docs and add a static guard for the removed public path.
- Upgrade: pr-lessons-only
