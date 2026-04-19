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

## Environment

Defaults are local-only:

1. `ADMIN_FRONT_URL=http://localhost:4000`
2. `ADMIN_GATEWAY_URL=http://localhost:8300`
3. `GATEWAY_POSTGRES_DSN=postgresql://synapse_gateway_app:local-dev-gateway-app-password@localhost:5432/synapse_gateway`
4. `ADMIN_EMAIL=super@synapse.network`
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

The seed fixture is written to:

```bash
tmp/admin-front-dogfood/fixture.json
```

Do not commit `tmp/` or `output/` evidence unless a release evidence bundle explicitly asks for it.
