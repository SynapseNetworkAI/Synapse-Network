# Agent Lessons: codex/fix-gateway-admin-staging-totp-env

### Lesson: Keep migration jobs independent from full app runtime settings

- Domain: staging deploy migration safety
- Severity: high
- Trigger: Gateway-admin Cloud Run migration job failed after package import side effects were fixed because TOTP legacy-secret migration still constructed full app settings.
- Root cause: Migration code used a narrow encryption-key dependency through the full Settings object, so unrelated runtime safety validations blocked database migration execution.
- Fix: Pass or read the migration-only TOTP encryption key directly, and ensure staging deploy scripts inject the matching Cloud Run Job env and Secret Manager binding.
- Rule: Migration and maintenance commands must not depend on full app runtime settings for narrow secret/config reads.
- Upgrade: bugfix docs and branch lesson
