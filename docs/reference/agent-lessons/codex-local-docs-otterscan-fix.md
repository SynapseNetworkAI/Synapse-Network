# Agent Lessons: codex-local-docs-otterscan-fix

Task: Fix local docs smart-contracts route and Otterscan startup.
Status: Active

## Push Review

## Lessons

### Lesson: Local frontend health checks must hit the routed page and recheck process liveness

- Domain: local-runtime
- Severity: warning
- Trigger: `docs-front` briefly served `/smart-contracts` during startup, then exited, leaving `http://localhost:3100/smart-contracts` unreachable after the local script reported success.
- Root cause: The local app launcher used a weaker docs health check and did not mirror `user-front`'s daemonization and post-health liveness guard.
- Fix: Start `docs-front` through the same `screen`/`nohup bash -lc` pattern as `user-front`, health-check `/smart-contracts`, and verify the port is still listening after startup.
- Rule: For local docs routes, a root-page or one-shot 200 is not enough; verify the exact documented route and confirm the dev server remains alive.
- Upgrade: agents-memory
