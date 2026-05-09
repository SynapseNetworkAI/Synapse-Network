### Lesson: Gateway migrations must prefer migrator credentials over runtime DSNs

- Domain: staging deploy database migration
- Severity: high
- Trigger: Cloud Run `synapse-staging-db-migrate` failed with `must be owner of table synapse_owner_accounts`.
- Root cause: The migration script selected `POSTGRES_DSN` before split `POSTGRES_MIGRATOR_*` fields, so staging DDL ran as the runtime app user instead of the schema owner.
- Fix: Select explicit migrator DSNs first, then split migrator fields, and use runtime `POSTGRES_DSN` only as a last-resort compatibility fallback.
- Rule: Deployment migration jobs must never let runtime credentials shadow available migrator credentials.
- Upgrade: Added unit coverage that fakes `psql` and asserts staging migrations use `synapse_gateway_migrator` when split migrator fields are present.
