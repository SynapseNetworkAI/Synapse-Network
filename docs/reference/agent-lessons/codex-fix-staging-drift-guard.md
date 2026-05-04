# Agent Lessons: codex-fix-staging-drift-guard

Task: Fix staging drift guard failure after Gateway deploy.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Cloud Run Job JSON shape must be parsed defensively

- Domain: ci
- Severity: warning
- Trigger: Staging deploy drift guard failed after gateway deploy while the job sync evidence showed empty `effectiveImage` values.
- Root cause: The deploy scripts assumed one Cloud Run Job JSON path for container images, but `gcloud run jobs describe --format=json` can expose service/job containers under different nested shapes.
- Fix: Extract container images by recursively finding the first container image and print drift guard failures directly to GitHub Actions stderr.
- Rule: Deployment guards that compare live Cloud Run Services and Jobs must parse resource JSON defensively and emit actionable failure summaries in CI logs.
- Upgrade: not required

### Lesson: Deploy identities should not need Secret Manager payload access

- Domain: ci
- Severity: warning
- Trigger: Staging drift guard failed because the GitHub Actions deploy identity lacked `secretmanager.versions.access` for secret payload linting.
- Root cause: The drift guard treated secret value linting as mandatory even though the deployment identity should only reference secrets, not read their plaintext payloads.
- Fix: Keep payload lint strict when the caller has access, but downgrade explicit Secret Manager payload permission denial to a warning.
- Rule: Deployment checks must respect least privilege; secret payload audits should run under a dedicated secret-auditor identity, not the normal deploy identity.
- Upgrade: not required
