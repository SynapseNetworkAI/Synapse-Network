### Lesson: Pause staging shutdown automation before Growing staging deploys

- Domain: deployment
- Severity: medium
- Trigger: Growing staging deployment failed during migration jobs while the staging Cloud SQL instance was stopped by local cost-control automation.
- Root cause: the local `staging_environment_shutdown_sweep` workflow reset `synapse-staging-postgres` to `activationPolicy=NEVER` while release builds were still in progress.
- Fix: pause or window the staging shutdown workflow before Growing staging deploys that need Cloud SQL migrations, then confirm Cloud SQL is `RUNNABLE` before starting the local deploy worker.
- Rule: restore the shutdown workflow and `activationPolicy=NEVER` only after deployment, smoke checks, and release task health verification complete.
- Upgrade: docs/reference/agent-lessons
