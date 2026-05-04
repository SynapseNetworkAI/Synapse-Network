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
