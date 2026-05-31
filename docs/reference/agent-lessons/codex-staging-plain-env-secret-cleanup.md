# Agent Lessons: codex-staging-plain-env-secret-cleanup

Task: Move staging non-credential config out of Secret Manager.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Plain config migration must clear live Cloud Run secret refs before deleting secrets

- Domain: ops
- Severity: warning
- Trigger: Moving staging non-credential values out of Secret Manager required deleting `synapse-staging-gmail-username` and `synapse-staging-gateway-admin-wallet`.
- Root cause: Cloud Run preserves env var type metadata, so a value cannot always be converted directly from Secret Manager ref to plain env in one update.
- Fix: Add an allowlisted migration script that writes ignored `env.staging`, removes live Cloud Run secret refs, adds equivalent plain env vars, verifies no references remain, and only then deletes the Secret Manager secrets.
- Rule: Plain config migration must update live Cloud Run references before deleting Secret Manager resources.
- Upgrade: not required
