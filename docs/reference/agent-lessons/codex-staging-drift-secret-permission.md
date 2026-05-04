# Agent Lessons: codex-staging-drift-secret-permission

Task: Fix staging drift guard failure when the deploy identity cannot read Secret Manager payloads.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Deploy identities should not need Secret Manager payload access

- Domain: ci
- Severity: warning
- Trigger: Staging drift guard failed because the GitHub Actions deploy identity lacked `secretmanager.versions.access` for secret payload linting.
- Root cause: The drift guard treated secret value linting as mandatory even though the deployment identity should only reference secrets, not read their plaintext payloads.
- Fix: Keep payload lint strict when the caller has access, but downgrade explicit Secret Manager payload permission denial to a warning.
- Rule: Deployment checks must respect least privilege; secret payload audits should run under a dedicated secret-auditor identity, not the normal deploy identity.
- Upgrade: not required
