---
id: admin-full-regression-e2e
title: Admin Full Regression E2E
status: canonical
created_at: 2026-05-03
updated_at: 2026-05-03
owner: admin-front
verified_with:
  - node --check scripts/e2e/admin_regression.mjs
  - node --check scripts/ci/admin_regression_evidence_check.mjs
  - cd services/gateway-admin && .venv/bin/python -m pytest tests/test_analytics_dashboard_repository.py -q
---

# Admin Full Regression E2E

This is the umbrella regression gate for Admin control-plane behavior. It does
not replace focused suites; it orchestrates them and adds a shared evidence
contract so screenshots, DOM assertions, API checks, and SQL state checks are
reviewed together.

## Commands

Local deterministic regression:

```bash
npm run e2e:admin-regression
npm run ci:admin-regression-evidence
```

Staging integration regression:

```bash
npm run e2e:admin-regression:staging
npm run ci:admin-regression-evidence
```

The local suite sets `ADMIN_ANALYTICS_SOURCE=postgres` and records
`expected_state.json`, `sql_evidence.json`, `screenshot_evidence.json`,
`report.json`, `report.md`, and `bugfix-log.md` under:

```text
output/dogfood/admin-regression/<runId>/
```

The focused Postgres Analytics API/SQL parity check can also be run directly:

```bash
npm run e2e:admin-analytics-postgres
```

## Functional Coverage

The umbrella gate covers:

1. Auth, MFA enrollment, reset success, failed-login lockout, sessions, and auth audit.
2. Dashboard, runtime, health, system, finance, and reconciliation pages.
3. Analytics overview and six drilldown pages through Postgres-only Admin Analytics APIs.
4. Approvals, withdrawal reviews, review history, execution, risk, and audit surfaces.
5. Users, roles, permissions, menu config, Provider Services, and Forum Support.
6. Consumer and Provider withdrawal approval/reject/final `COMPLETED` flows through existing focused suites.
7. In-app notification outbox, Lark alert evidence, transaction notification evidence, and staging Gmail evidence.
8. Platform fee treasury Safe draft readiness through the Finance surface and backend-owned Safe draft API.

## SQL Evidence Contract

Every admin-regression run must include SQL probes for:

1. Admin auth/RBAC/audit tables: `admin_users`, `admin_sessions`,
   `admin_mfa_factors`, `admin_roles`, `admin_permissions`,
   `admin_role_permissions`, `admin_action_audit`.
2. Admin approval/execution tables: `admin_approvals`,
   `admin_approval_steps`, `admin_approval_events`, `admin_execution_jobs`,
   `admin_execution_attempts`.
3. Admin finance projection views:
   `synapse_admin_dashboard_finance_projection`,
   `synapse_admin_dashboard_activity_trend_projection`,
   `synapse_admin_dashboard_operations_projection`,
   `synapse_admin_dashboard_projection`.
4. Gateway withdrawal/funds tables: `synapse_vault_withdrawals`,
   `synapse_account_balances`, `synapse_ledger_entries`.
5. Notification tables: `synapse_notification_outbox`,
   `synapse_notification_delivery_log`, `synapse_in_app_notifications`.
6. Forum tables: `synapse_forum_topics`, `synapse_forum_replies`,
   `synapse_forum_response_tasks`.
7. Analytics table: `synapse_analytics_outbox`, with evidence declaring
   `source = postgres`.
8. Provider/risk tables: `synapse_provider_profiles`,
   `synapse_provider_payout_accounts`, `synapse_provider_risk_flags`.

SQL evidence is a hard gate. A browser screenshot or API response cannot
override a failed SQL probe.

## Screenshot Evidence Contract

Screenshots are valid only when paired with machine-readable evidence:

1. DOM/page summary for the same route.
2. API response or browser assertion that proves the visible value.
3. SQL evidence for the underlying table or projection.
4. Forbidden blocker text absence, such as `Loading`, `Error`, `Unauthorized`,
   `Pending`, or `Ticket Ready` when the expected final state is `COMPLETED`.

Bare PNG existence is not evidence. The checker requires final-state coverage
for Analytics, Finance, Provider Services, Withdrawal, and Forum Support
surfaces.

## Analytics Postgres-Only Rule

Admin Analytics now defaults to `PostgresAnalyticsDashboardRepository`.
`ClickHouseAnalyticsDashboardRepository` remains only as an explicit
`ADMIN_ANALYTICS_SOURCE=clickhouse` compatibility escape hatch and is not a
passing source for this admin-regression gate.

The 10k analytics regression must verify Postgres raw analytics rows,
gateway-admin API responses, Admin-front DOM values, and screenshots. ClickHouse
is not the Admin Analytics truth source for this gate.

## Pass Criteria

The umbrella gate passes only when:

1. Every orchestrated E2E step exits successfully.
2. `report.json.status === "success"`.
3. `expected_state.json.analyticsSource === "postgres"`.
4. Every SQL probe returns `ok: true`.
5. Screenshot evidence is bound to DOM/page assertions and covers the required surfaces.
6. Withdrawal success cases reach chain claim plus Gateway complete, with DB status `COMPLETED`.
7. Notification evidence includes outbox and in-app rows locally; staging adds real delivery ids when configured.

If any failure reveals a product bug, record it under
`docs/reference/bugfix/admin/BUG-ADMIN-*.md`, fix it, rerun the failed case, and
then rerun the full admin regression.
