# gateway-admin Hard Rules

This file is the local execution mirror for `services/gateway-admin/`.

## Canonical Sources

1. `docs/AGENTS.md`
2. `.github/instructions/python.instructions.md`
3. `.github/instructions/finance-backend.instructions.md`
4. `.github/instructions/finance-admin.instructions.md`
5. `docs/03_Projects/gateway-admin/Gateway_Admin_Agent_Rules.md`

## Role Boundary

- `gateway-admin` is the admin control-plane backend.
- It is not a second `gateway` runtime.
- It must expose authenticated, audited, role-scoped admin APIs only.

## Project-Specific Constraints

- Never couple directly to `gateway/src/domain` internals.
- Prefer controlled adapters and read-only projections for cross-service access.
- New admin control-plane semantics must come from backend-owned fields and endpoints, not frontend invention.
- Dashboard projection views are CQRS read models. Query explicit native columns and map them to typed dataclasses; do not use `row_to_json` or projection `SELECT *`.
- If behavior touches approvals, retries, withdrawals, refunds, deposit repair, or reconciliation, update tests and docs in the same change.
- Use `finance-admin.instructions.md` as the narrow rule source for withdrawal review, refund approval, deposit repair, reconciliation drilldown, and finance review execution flows.

## Environment

- Use the local virtual environment only:

```bash
services/gateway-admin/.venv/bin/python
```

## Validation

```bash
cd services/gateway-admin
services/gateway-admin/.venv/bin/python -m pytest tests -q
```

`npm run ci:admin-gateway` is the repo-standard service gate and runs the
full gateway-admin pytest suite. Finance-review, withdrawal, refund,
reconciliation, approval, or internal Gateway adapter changes must also pass
the repo-level guardrails from `npm run ci:pr`, including finance Semgrep,
finance mypy, architecture quality, secret scanning, test-quality checks, and
incremental diff coverage.

## Operations

```bash
cd services/gateway-admin
sh scripts/ops/start-local.sh
sh scripts/ops/start-staging.sh
sh scripts/ops/stop.sh
sh scripts/ops/restart.sh local
sh scripts/ops/restart.sh staging
sh scripts/ops/status.sh
```

## Stop Conditions

- Stop and fix before finishing if frontend must infer backend truth, observable behavior changed without docs, or API behavior changed without tests.
