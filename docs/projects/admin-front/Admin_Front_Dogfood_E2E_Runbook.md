# Admin Front Dogfood E2E Runbook

- Status: canonical
- Code paths: `scripts/e2e/admin_front_seed.mjs`, `scripts/ui/dogfood_admin_front.mjs`, `scripts/e2e/admin_front_reconcile.mjs`
- Verified with: `npm run e2e:admin-front`
- Last verified against code: 2026-04-19

## Purpose

This runbook verifies that `admin-front` is not only rendering pages, but is actually connected to `gateway-admin`, the gateway database, and real control-plane data. Screenshots are evidence for visual review; pass/fail is based on browser clicks, API responses, and DB/API/UI reconciliation.

## Scope

The dogfood suite covers:

1. Auth smoke pages: `/login`, `/login/mfa-enroll`, `/login/reset-success`.
2. Dashboard pages: `/dashboard/overview`, `/dashboard/runtime`, `/dashboard/analytics`, and the six analytics drilldown pages.
3. Ops pages: `/execution`, `/provider-services`, `/forum-support`, `/system`.
4. Governance pages: `/users`, `/role-permissions`, `/menu-config`.
5. Review, risk, and finance pages: `/approvals`, `/withdrawal-reviews`, `/review-history`, `/finance`, `/finance/reconciliation`, `/risk`, `/audit`.
6. Data truth checks for Forum Support, Provider Services, Finance, and Analytics.

For Admin-wide regression, use
[Admin_Full_Regression_E2E.md](./Admin_Full_Regression_E2E.md). That umbrella
suite runs the focused Admin E2Es and adds SQL evidence for admin auth/RBAC,
approval/execution, finance projections, withdrawal/funds tables,
notifications, Forum Support, Provider Services, and Postgres Analytics.

Analytics has an additional full-chain contract in
[Admin_Analytics_Page_Function_and_Verification.md](./Admin_Analytics_Page_Function_and_Verification.md).
That contract verifies Gateway events reached the configured analytics source,
gateway-admin returns the same aggregates as raw SQL, and admin-front renders the
same values on all seven Analytics pages. For the Admin regression gate, the
configured source is Postgres, not ClickHouse.

For high-volume local/staging evidence, use
[Admin_Analytics_10k_Load_Dogfood_Verification.md](./Admin_Analytics_10k_Load_Dogfood_Verification.md).
That suite sends 10,000 paid invokes across three Provider services and validates
Analytics pages with baseline + delta reconciliation.

## Dependencies

Run against local or staging services:

```bash
sh scripts/local/restart_gateway.sh
cd services/gateway-admin && .venv/bin/uvicorn src.app:app --host 0.0.0.0 --port 8300
cd services/admin-front && yarn dev
```

The database must already contain the forum support schema. Runtime gateway-admin does not create tables; apply the reviewed Postgres bootstrap/migration first.

## Commands

Seed deterministic data:

```bash
npm run e2e:admin-front:seed
```

Run browser dogfood:

```bash
npm run e2e:admin-front:dogfood
```

Reconcile report, API, and DB:

```bash
npm run e2e:admin-front:reconcile
```

Run the full flow:

```bash
npm run e2e:admin-front
```

Run the Admin-wide regression evidence bundle:

```bash
npm run e2e:admin-regression
npm run ci:admin-regression-evidence
```

Run the Analytics-specific full-chain flow:

```bash
cd services/gateway
ANALYTICS_FULLCHAIN_E2E=true \
ANALYTICS_CLICKHOUSE_URL=http://localhost:8123 \
PYTHONPATH=. pytest tests/e2e/test_01_infrastructure.py \
  tests/e2e/test_02_wallet_auth.py \
  tests/e2e/test_03_fund_wallet.py \
  tests/e2e/test_04_deposit.py \
  tests/e2e/test_05_provider_register.py \
  tests/e2e/test_06_agent_credential.py \
  tests/e2e/test_07_invoke.py \
  tests/e2e/test_08_analytics_fullchain.py -q

cd ../..
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 \
/usr/bin/python3 scripts/admin_analytics_clickhouse_regression.py

ADMIN_FRONT_URL=http://127.0.0.1:3200 \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ADMIN_SESSION_TOKEN="<synapse_admin_session>" \
node scripts/admin_analytics_fullchain_e2e.js
```

Run the Analytics 10k load dogfood:

```bash
npm run e2e:admin-analytics-10k:fullchain
npm run e2e:admin-analytics-10k:reconcile
ADMIN_SESSION_TOKEN="<synapse_admin_session>" npm run e2e:admin-analytics-10k:dogfood
```

## Environment

Defaults are local-only:

1. `ADMIN_FRONT_URL=http://localhost:3200`
2. `ADMIN_GATEWAY_URL=http://localhost:8300`
3. `GATEWAY_POSTGRES_DSN=postgresql://synapse_gateway_app:local-dev-gateway-app-password@localhost:5432/synapse_gateway`
4. `ADMIN_EMAIL=cliff@synapse-network.ai`
5. `ADMIN_PASSWORD=qwer@1234`
6. `ADMIN_OTP_CODE` is optional when the local TOTP flow is disabled; otherwise provide a current code.

For staging, use `ADMIN_SESSION_TOKEN` or explicit staging credentials. The seed script refuses to use the default local password against non-local URLs.

## Pass Criteria

The suite passes only when:

1. `report.json.failed.length === 0`.
2. `report.json.consoleErrors.length === 0`.
3. All required screenshots exist under `output/dogfood/admin-front/<timestamp>/screenshots/`.
4. `/forum-support` shows the seeded response task.
5. Sending a reply from admin-front creates a row in `synapse_forum_replies`.
6. `synapse_forum_response_tasks.status` becomes `responded` and `reply_id` is non-empty.
7. Provider Services, Finance, and Analytics pages show data that came from `gateway-admin` APIs.
8. The reconcile script confirms DB/API/UI evidence for the same run id.
9. Analytics-specific verification confirms all seven Analytics APIs match the configured raw analytics SQL source. For `admin-regression`, this source must be Postgres.
10. Analytics browser verification confirms window switchers, drilldown cards, budget-block alert drilldown, and seven screenshots.
11. Optional 10k Analytics load verification confirms three registered Provider services, 10,000 paid invokes, `7900.000000 USDC` service-price GMV baseline, receipt total-charge GMV delta, Postgres analytics evidence for the Admin regression gate, gateway-admin aggregation, and admin-front DOM values.
12. Admin-wide regression evidence confirms screenshots are bound to DOM assertions and SQL probes; bare PNG existence is not accepted.

## Provider Withdrawal Approval Full-Chain Verification

Provider withdrawal approval has a separate finance-sensitive full-chain suite:

```bash
WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC=1.000000 sh scripts/local/restart_gateway.sh
sh scripts/local/restart_gateway_admin.sh
cd services/admin-front && yarn dev

npm run e2e:admin-withdrawal-approval
```

See [Admin_Withdrawal_Approval_E2E_Verification.md](./Admin_Withdrawal_Approval_E2E_Verification.md).

That suite validates:

1. Gateway creates a real `PENDING_MANUAL_REVIEW` Provider withdrawal from real Provider receivable.
2. admin-front `/withdrawal-reviews` approves it through gateway-admin and Gateway internal API.
3. Provider executes `SynapseCore.withdraw(...)` on-chain with the issued ticket.
4. Gateway completion writes txHash and moves the withdrawal to `COMPLETED`.
5. Postgres, Gateway API, gateway-admin API, admin-front screenshots, and chain balances agree.
6. Duplicate withdrawal, duplicate approval, cross decision, ticket replay, amount tampering, and invalid internal token checks all fail safely; duplicate complete with the same `txHash` is a stable replay and must not duplicate funds movement, audit, or notifications.

## Failure Handling

If the suite fails:

1. Record the issue under `docs/reference/bugfix/admin-front/` or `docs/reference/bugfix/gateway-admin/`.
2. Include reproduction, root cause, fix, verification, and residual risk.
3. Fix the bug.
4. Rerun the narrow failed command.
5. Rerun `npm run e2e:admin-front` before marking the dogfood pass.

## Outputs

The browser run writes:

1. `output/dogfood/admin-front/<timestamp>/report.md`
2. `output/dogfood/admin-front/<timestamp>/report.json`
3. Page screenshots for every covered route.
4. Focused screenshots for Forum Support before/after reply and sidebar navigation clicks.

The Analytics-specific run writes:

1. `output/analytics-fullchain/report.json`
2. `output/analytics-fullchain/admin-clickhouse-regression.json`
3. `output/analytics-fullchain/admin-page-verification.json`
4. `output/analytics-fullchain/screens/*.png`

The 10k Analytics load run writes:

1. `output/analytics-load/<runId>/fixture.json`
2. `output/analytics-load/<runId>/report.json`
3. `output/analytics-load/<runId>/report.md`
4. `output/analytics-load/<runId>/admin-page-verification.json`
5. `output/analytics-load/<runId>/screens/*.png`

The Admin-wide regression run writes:

1. `output/dogfood/admin-regression/<runId>/expected_state.json`
2. `output/dogfood/admin-regression/<runId>/sql_evidence.json`
3. `output/dogfood/admin-regression/<runId>/screenshot_evidence.json`
4. `output/dogfood/admin-regression/<runId>/report.json`
5. `output/dogfood/admin-regression/<runId>/report.md`
6. `output/dogfood/admin-regression/<runId>/bugfix-log.md`

The seed fixture is written to:

```bash
tmp/admin-front-dogfood/fixture.json
```

Do not commit `tmp/` or `output/` evidence unless a release evidence bundle explicitly asks for it.
