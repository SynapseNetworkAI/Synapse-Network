# Gateway Admin Login Lockout Dogfood E2E

Status: active

Code paths: `services/gateway-admin/src/services/auth/service.py`, `services/gateway-admin/scripts/dogfood_admin_login_lockout_user.py`, `services/admin-front/src/app/login`, `scripts/ui/dogfood_admin_login_lockout.mjs`

Verified with: `npm run e2e:admin-login-lockout:dogfood`

Last verified against code: 2026-04-24

## Purpose

This runbook proves the admin login brute-force guard from the browser down to Postgres:

1. Create a disposable local admin account.
2. Open Admin-front login in Playwright.
3. Submit four wrong passwords and verify generic `401 UNAUTHORIZED` UX.
4. Submit the fifth wrong password and verify the account is locked.
5. Submit the correct password and verify `423 ADMIN_ACCOUNT_LOCKED` renders the Chinese lockout message.
6. Assert Postgres state and audit records.
7. Delete the disposable test account.
8. Write screenshots, video, `report.json`, `report.md`, and `bugfix-log.md`.

This dogfood suite is local-only. It refuses staging/prod URLs and non-local database DSNs.

## Required Local Services

Start the local admin backend and frontend:

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
sh scripts/ops/start-local.sh

cd /Users/cliff/workspace/agent/Synapse-Network/services/admin-front
yarn dev
```

Expected defaults:

| Service | URL |
| --- | --- |
| Admin-front | `http://localhost:4000` |
| Gateway-admin | `http://localhost:8300` |
| Admin Postgres DSN | `postgresql://synapse_admin_app:local-dev-admin-app-password@localhost:5432/synapse_gateway_admin` |

If your local DSN differs, pass it with `ADMIN_LOCKOUT_DOGFOOD_DSN`.

## Command

```bash
cd /Users/cliff/workspace/agent/Synapse-Network
npm run e2e:admin-login-lockout:dogfood
```

Useful overrides:

```bash
ADMIN_FRONT_URL=http://localhost:4000 \
ADMIN_GATEWAY_URL=http://localhost:8300 \
ADMIN_LOCKOUT_DOGFOOD_DSN='postgresql://synapse_admin_app:local-dev-admin-app-password@localhost:5432/synapse_gateway_admin' \
ADMIN_LOCKOUT_DOGFOOD_HEADFUL=1 \
npm run e2e:admin-login-lockout:dogfood
```

## Evidence Output

The runner writes:

```text
output/dogfood/admin-login-lockout/<timestamp>/
├── report.json
├── report.md
├── bugfix-log.md
├── screenshots/
│   ├── 01-login-initial.png
│   ├── 02-wrong-password-1.png
│   ├── 03-wrong-password-2.png
│   ├── 04-wrong-password-3.png
│   ├── 05-wrong-password-4.png
│   ├── 06-fifth-failure-lock-triggered.png
│   └── 07-locked-message.png
└── videos/
    └── *.webm
```

Passing evidence must show:

1. `report.json.status === "success"`.
2. `failed.length === 0`.
3. Browser evidence includes the Chinese lockout message: `账号因连续登录失败已临时锁定，请 24 小时后重试或联系 Owner。`
4. API evidence includes four or more `401 UNAUTHORIZED` responses and one `423 ADMIN_ACCOUNT_LOCKED` response.
5. DB assertion shows `failedLoginAttempts >= 5`, `lockedUntil` in the future, and audit counts for `admin.login.failure`, `admin.login.locked`, and `admin.login.blocked_locked`.
6. Cleanup shows the disposable `admin_users` row was deleted.

## Bugfix Loop

If the run fails, do not mark the lockout feature verified.

1. Open `output/dogfood/admin-login-lockout/<timestamp>/bugfix-log.md`.
2. Fix the first `Open` bug.
3. Re-run `npm run e2e:admin-login-lockout:dogfood`.
4. Repeat until the newest report has `status=success` and no failed steps.

The dogfood helper deletes the disposable account in `finally`. If a run is killed mid-flight, the next `create` action removes any previous dogfood account with the same email before recreating it.

## Safety Boundary

The helper script refuses:

1. Non-local Admin-front or Gateway-admin URLs.
2. Non-local Postgres DSNs.
3. Prod-like database names.

Do not bypass these guards. Staging and production account lockout behavior is verified through API tests, logs, and Cloud Monitoring evidence, not by intentionally locking real operators through browser dogfood.
