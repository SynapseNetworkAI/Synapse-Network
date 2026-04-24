# BUG-ADMIN-LOGIN-LOCKOUT-DOGFOOD-LOCAL-SCHEMA-DRIFT

Status: fixed

Code paths: `services/gateway-admin/scripts/dogfood_admin_login_lockout_user.py`, `scripts/ui/dogfood_admin_login_lockout.mjs`, `infra/postgres/init/gateway-admin/003_gateway_admin_projection_views.sql`

Verified with: `npm run e2e:admin-login-lockout:dogfood`

Last verified against code: 2026-04-24

## Summary

The first local admin login lockout dogfood run failed before browser verification because the local `synapse_gateway_admin` database had not applied the new account-lockout columns:

```text
psycopg.errors.UndefinedColumn: column "failed_login_attempts" of relation "admin_users" does not exist
```

After applying the target-state admin SQL, a second run still failed because the running `gateway-admin` process was stale and had not loaded the new lockout implementation. The fifth failed password attempt did not lock the disposable account, and the next correct-password attempt returned `200` instead of `423 ADMIN_ACCOUNT_LOCKED`.

## Root Cause

Two local runtime layers were out of sync with the checked-out code:

1. Local Postgres schema lagged behind `infra/postgres/init/gateway-admin/003_gateway_admin_projection_views.sql`.
2. The local `gateway-admin` process was still running old Python code after the lockout feature changed.

This was not a production logic regression. The targeted API tests passed after the service and local schema were aligned.

## Fix

Apply the gateway-admin target-state SQL to the local admin database, then restart `gateway-admin`:

```bash
services/gateway-admin/.venv/bin/python services/gateway-admin/scripts/apply_migrations.py \
  --dsn 'postgresql://cliff@localhost:5432/synapse_gateway_admin' \
  --sql-file infra/postgres/init/gateway-admin/003_gateway_admin_projection_views.sql \
  --app-user synapse_admin_app

cd services/gateway-admin
sh scripts/ops/restart.sh local
```

If the managed restart exits unexpectedly in a local shell, run the same app in foreground for dogfood debugging:

```bash
set -a
source services/gateway-admin/.env.local
set +a
cd services/gateway-admin
.venv/bin/uvicorn src.app:app --host 0.0.0.0 --port 8300
```

## Final Evidence

Final passing dogfood evidence:

```text
output/dogfood/admin-login-lockout/2026-04-24T141759820Z/
```

Result:

1. Browser lockout lifecycle passed.
2. DB assertion passed with `failedLoginAttempts=5`.
3. Audit counts included `admin.login.failure`, `admin.login.locked`, and `admin.login.blocked_locked`.
4. Disposable admin test account was deleted.
5. Final `bugfix-log.md` had no open bugs.
