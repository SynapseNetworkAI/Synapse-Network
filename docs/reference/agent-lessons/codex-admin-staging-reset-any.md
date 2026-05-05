# Agent Lessons: codex-admin-staging-reset-any

Task: Extend staging admin password reset tooling beyond the dedicated E2E account.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Custom admin resets must not overwrite shared E2E secrets

- Domain: ops
- Severity: warning
- Trigger: Extending the staging admin reset script from the dedicated E2E account to arbitrary staging admin accounts.
- Root cause: The original script always wrote generated credentials into `synapse-staging-admin-e2e-password` and `synapse-staging-admin-e2e-otp-secret`, which would be unsafe for real staging operator resets.
- Fix: Keep the default E2E Secret Manager write path, but default custom admin resets to one-time terminal output unless custom secret ids are explicitly supplied.
- Rule: Account recovery tooling that broadens target scope must also narrow credential storage and require explicit operator confirmation.
- Upgrade: not required

### Lesson: Staging migrations must guard schema ownership, not only table existence

- Domain: deploy
- Severity: warning
- Trigger: Staging Cloud SQL showed an apparently empty `synapse_gateway_staging` schema in Cloud SQL Studio, while existing tables were owned by the runtime app user and hidden from the migrator/operator path.
- Root cause: Bootstrap and deploy checks verified instance/database/secrets, but did not fail fast when runtime-owned schema objects made future migrations unable to alter existing tables.
- Fix: Repair staging object ownership to `synapse_gateway_migrator`, restore runtime grants to `synapse_gateway_app`, add migration-time schema ownership/table/grant guardrails, and add a manual staging schema guard.
- Rule: Shared environment migrations must validate required tables, migrator ownership, runtime grants, and DSN/password secret consistency before rollout.
- Upgrade: agents-memory

### Lesson: Cloud SQL public IPv4 is not the access policy

- Domain: ops
- Severity: warning
- Trigger: Cloud SQL security recommendations flagged public/unsecured access while the intended V1 design is Auth Proxy / connector-only access.
- Root cause: Terraform did not explicitly encode connector enforcement, empty authorized networks, IAM DB auth, or password policy, leaving the intended security model implicit.
- Fix: Make Cloud SQL connector enforcement, empty authorized networks, IAM auth, backups/PITR, and password policy part of Terraform and drift guard checks.
- Rule: Shared Cloud SQL instances may keep public IPv4 for Auth Proxy DX only when connector enforcement is required and authorized networks are empty.
- Upgrade: agents-memory
