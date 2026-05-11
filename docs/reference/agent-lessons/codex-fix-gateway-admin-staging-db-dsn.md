# Agent Lessons: codex/fix-gateway-admin-staging-db-dsn

### Lesson: Cloud Run migration jobs must receive the same DSN secrets as the service

- Trigger: `gateway-admin` staging deploy updated the migration job image but only injected the TOTP secret, so `apply_migrations.py` fell back to the local default DSN and tried `127.0.0.1:5432` inside Cloud Run.
- Domain: staging deploy migration safety
- Severity: high
- Root cause: The imperative deploy path updated the Cloud Run Job image and a narrow secret but did not preserve the Terraform-defined admin database DSN secret environment.
- Fix: Update gateway-admin Cloud Run jobs and services with the complete staging admin secret set, including `ADMIN_DATABASE_MIGRATION_DSN` and `ADMIN_DATABASE_DSN`, before executing migration guards.
- Rule: Imperative deploy scripts that update Cloud Run jobs must mirror the canonical Terraform env/secret contract for that job family.
- Upgrade: branch lesson and deploy script guardrail
