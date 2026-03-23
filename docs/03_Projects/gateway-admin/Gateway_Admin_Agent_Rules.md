# Gateway Admin Agent Rules

## Rule Sources

1. `docs/AGENTS.md`: workspace-level product, security, and governance constraints.
2. `.github/instructions/python.instructions.md`: shared Python and FastAPI coding rules.
3. `.github/instructions/finance-backend.instructions.md`: shared finance-sensitive backend transaction rules.
4. `.github/instructions/finance-admin.instructions.md`: narrow rules for finance approval, withdrawal review, refund approval, deposit repair, and reconciliation control-plane flows.
5. This file: `gateway-admin` local role boundary, environment, validation, and project-level backend constraints.

## Role

1. `gateway-admin` is the admin control-plane backend.
2. It is not a second `gateway` runtime.
3. It must expose authenticated, audited, role-scoped admin APIs only.

## Layering

1. `src/api/routers/`: request parsing, dependency injection, response return only.
2. `src/services/`: orchestration, policy, aggregation, workflow logic.
3. `src/api/schemas/`: request and response models only.
4. `src/storage/`: repository and read-model access only.
5. `src/core/`: settings, middleware, logging, errors, shared dependencies.
6. `src/utils/`: small shared helpers only.

Hard boundaries:

1. Never put SQL in routers.
2. Never put permission branching or workflow orchestration in routers.
3. Never access the database outside `src/storage/`.

## Gateway Boundary

1. Never couple directly to `gateway/src/domain` internals.
2. Use controlled adapters under `src/services/adapters/` for cross-service actions.
3. Exchange data through stable DTOs, API contracts, service tokens, and read-only projections.

Preferred dashboard read models:

1. `synapse_admin_dashboard_projection`
2. `synapse_admin_dashboard_finance_projection`
3. `synapse_admin_dashboard_activity_trend_projection`
4. `synapse_admin_dashboard_operations_projection`

## Security

1. Default deny for non-public admin APIs.
2. Require valid admin session on protected routes.
3. Require CSRF protection for browser write requests.
4. Enforce step-up OTP on high-risk actions where configured.
5. Never trust role, permission, amount, or ownership from frontend input alone.
6. Never leak stack traces, SQL internals, secrets, MFA seeds, or adapter internals in responses.
7. Any control-plane state change must remain auditable.

## Money and Data Safety

1. Preserve idempotency, transactional consistency, append-only auditability, and strict validation.
2. Use decimal-safe monetary handling only.
3. Never introduce float accounting.
4. Never bypass repository constraints with inline SQL in services.

For detailed finance review, withdrawal review, refund approval, deposit repair, reconciliation, retry, and execution-flow semantics, follow `.github/instructions/finance-admin.instructions.md` instead of re-declaring those narrow rules here.

## API and Semantics

1. Keep schemas explicit.
2. Preserve existing field aliases unless the contract change is intentional and documented.
3. New admin read APIs should aggregate in services, not in routers and not in frontend.
4. New control-plane semantics must come from backend-owned fields or endpoints.
5. Never make frontend invent dashboard or system status semantics from unrelated endpoints.

For approval queue, provider withdrawal review, review history, reconciliation detail, and execution-job semantics, keep the detailed backend-owned state model in the finance-admin instruction and the code contract, not as duplicated prose in this file.

## Pagination Semantics

1. Backend owns pagination truth.
2. Paginated read APIs should expose explicit filter params.
3. When a list page needs visible pagination metadata, the API should return stable fields such as `totalCount`, `totalPages`, and `nextCursor` or equivalent.
4. Filter changes must reset pagination from the first page on both backend contract path and frontend state.
5. Reset-filter behavior should map cleanly to backend defaults.

## Coding Rules

1. Prefer small service methods over large orchestration blocks.
2. Extract repeated mapping or status-resolution logic into helpers.
3. Prefer typed models over loose dictionaries when practical.
4. Keep dependency and security boundaries obvious in code.

## Tests and Docs

1. Any meaningful backend change must include tests.
2. Prioritize behavior and contract tests.
3. Update `tests/test_app.py` when API shape, permission behavior, or status semantics change.
4. Update `docs/admin/` in the same change when observable backend behavior changes.
5. Do not ship backend behavior changes without tests and matching docs.
6. Finance review and withdrawal-review changes must also keep `finance-admin.instructions.md` aligned if that flow's rule boundary changes.

## Environment

Use the local virtual environment only:

```bash
/Users/cliff/workspace/Synapse-Network/admin/gateway-admin/.venv/bin/python
```

## Validation

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
/Users/cliff/workspace/Synapse-Network/admin/gateway-admin/.venv/bin/python -m pytest tests/test_app.py -q
```

## Operations

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
sh scripts/ops/start-local.sh
sh scripts/ops/stop.sh
sh scripts/ops/restart.sh
sh scripts/ops/status.sh
```

## Stop Conditions

1. router contains business logic
2. service contains inline SQL
3. frontend must infer backend truth by itself
4. API contract changed without test updates
5. observable behavior changed without doc updates