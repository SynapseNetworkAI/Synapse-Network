---
id: BUG-ADMIN-20260503-admin-regression-local-dsn-and-withdrawal-seed
title: Admin regression local DSN and withdrawal seed drift
status: fixed
created_at: 2026-05-03
fixed_at: 2026-05-03
owner: admin-front
verified_with:
  - npm run e2e:admin-front
  - npm run e2e:admin-regression
  - npm run ci:admin-regression-evidence
  - npm run ci:finance-approval-safety
  - npm run ci:quality-budget
---

# Admin Regression Local DSN And Withdrawal Seed Drift

## Impact

Local Admin regression could fail before proving the full control-plane chain:

1. `gateway-admin` used stale local Gateway DSNs and returned `Internal server error` for dashboard or Forum Support API calls.
2. The Admin withdrawal approval seed still created a Provider withdrawal below the new 10 USDC minimum, so the request correctly failed with `MIN_WITHDRAWAL_AMOUNT_NOT_MET`.
3. Local MFA binding changed the super admin active TOTP secret, while regression scripts assumed the bootstrap default.
4. Isolated withdrawal suites created per-run Postgres databases, but setup/migration/runtime could disagree on the target database and leave balances or tables in the wrong local DB.
5. Gateway restarts after local contract redeploys did not consistently propagate the latest MockUSDC address, producing false `INSUFFICIENT_VAULT_LIQUIDITY` failures.
6. Provider same-key idempotency replay could miss Redis after funds were locked and then fail the T+7 maturity check instead of returning the original pending withdrawal.
7. Local notification dogfood used a synthetic JWT and transaction notification DSN discovery could accidentally read the wrong local `.env.local` database.
8. Admin withdrawal review screenshots treated any visible `401` text as a blocker, which caused false negatives when a real withdrawal id contained those digits.

## Fix

1. Local `.env.local` was aligned to the Docker Gateway DB for readonly and Forum Support write access.
2. Admin regression now resolves the active local super admin TOTP secret from the Admin DB and passes it only to child processes; it is not written to evidence.
3. The Admin withdrawal approval seed now creates enough paid usage and a 100 USDC withdrawal, then ages the Provider charge ledger row by 8 days so it satisfies the Provider T+7 withdrawal policy.
4. Admin-front dogfood now preflights all dashboard API endpoints and waits for the Forum Support final DOM before screenshot verification.
5. Local isolated DB setup now creates and migrates the requested target DB, passes the same DSN to Gateway runtime, and closes migration storage pools cleanly.
6. Gateway restart now restores the deployed MockUSDC address from local contract config before relaunching Gateway.
7. Provider withdrawal creation resolves matching active pending withdrawals before maturity checks, preserving same-key idempotency after the first lock.
8. Notification dogfood now performs real wallet challenge auth locally, and transaction notification local mode only honors explicit DSN env overrides before falling back to the Docker Gateway DB.
9. Admin regression restores Gateway and user-front after isolated suites, records per-function results, and binds screenshot verification to DOM/API/SQL evidence.

## Verification

The local Admin regression passed after the fix, including:

1. Dashboard API preflight for auth and dashboard endpoints.
2. Frontend click coverage across Admin pages.
3. Forum Support reply flow.
4. DB/API reconcile for the responded forum task and Provider Services.
5. Withdrawal risk policy, idempotency/concurrency, Admin approval, review dogfood, in-app notifications, Lark alert outbox, transaction notifications, and Postgres analytics gates.

The evidence bundle is written under `output/dogfood/admin-regression/` and includes `function_results.md`, `function_results.json`, SQL evidence, API evidence, DOM assertions, and screenshot metadata for each Admin function area.
