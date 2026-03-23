# gateway-admin Hard Rules

## Role

- `gateway-admin` is the admin control-plane backend.
- It is not a second `gateway` runtime.
- It must expose authenticated, audited, role-scoped admin APIs only.

## Layering

- `src/api/routers/`: request parsing, dependency injection, response return only.
- `src/services/`: orchestration, policy, aggregation, workflow logic.
- `src/api/schemas/`: request and response models only.
- `src/storage/`: repository and read-model access only.
- `src/core/`: settings, middleware, logging, errors, shared dependencies.
- `src/utils/`: small shared helpers only.
- Never put SQL in routers.
- Never put permission branching or workflow orchestration in routers.
- Never access the database outside `src/storage/`.

## Gateway Boundary

- Never couple directly to `gateway/src/domain` internals.
- Use controlled adapters under `src/services/adapters/` for cross-service actions.
- Exchange data through stable DTOs, API contracts, service tokens, and read-only projections.
- Prefer these controlled dashboard read models when they fit:
  - `synapse_admin_dashboard_projection`
  - `synapse_admin_dashboard_finance_projection`
  - `synapse_admin_dashboard_activity_trend_projection`
  - `synapse_admin_dashboard_operations_projection`

## Security

- Default deny for non-public admin APIs.
- Require valid admin session on protected routes.
- Require CSRF protection for browser write requests.
- Enforce step-up OTP on high-risk actions where configured.
- Never trust role, permission, amount, or ownership from frontend input alone.
- Never leak stack traces, SQL internals, secrets, MFA seeds, or adapter internals in responses.
- Any control-plane state change must remain auditable.

## Money and Data Safety

- Preserve idempotency, transactional consistency, append-only auditability, and strict validation.
- Use decimal-safe monetary handling only.
- Never introduce float accounting.
- Never bypass repository constraints with inline SQL in services.
- If behavior touches approvals, retries, withdrawals, refunds, deposit repair, or reconciliation, update tests and docs in the same change.

## API and Semantics

- Keep schemas explicit.
- Preserve existing field aliases unless the contract change is intentional and documented.
- New admin read APIs should aggregate in services, not in routers and not in frontend.
- New control-plane semantics must come from backend-owned fields or endpoints.
- Never make frontend invent dashboard or system status semantics from unrelated endpoints.

## Pagination Semantics

- Backend owns pagination truth. Frontend must not infer total pages or total records from the current slice.
- Paginated read APIs should expose explicit filter params instead of relying on frontend-only filtering for canonical list views.
- When a list page needs visible pagination metadata, the API should return stable fields such as `totalCount`, `totalPages`, and the next-page primitive such as `nextCursor` or an equivalent page token.
- Filter changes must reset pagination from the first page on the backend contract path as well as in frontend state.
- Default filter semantics should be explicit: omitted or empty filter values mean the default unfiltered view.
- Search submission semantics should be deterministic. The backend should treat search requests triggered by button click and Enter submit identically because both resolve to the same API params.
- Reset-filter behavior should map cleanly to backend defaults. Do not require the frontend to invent special reset-only endpoints unless there is a documented business need.

## Coding Rules

- Prefer small service methods over large orchestration blocks.
- Extract repeated mapping or status-resolution logic into helpers.
- Prefer typed models over loose dictionaries when practical.
- Keep dependency and security boundaries obvious in code.

## Tests and Docs

- Any meaningful backend change must include tests.
- Prioritize behavior and contract tests.
- Update `tests/test_app.py` when API shape, permission behavior, or status semantics change.
- Update `docs/admin/` in the same change when observable backend behavior changes.
- Do not ship backend behavior changes without tests and matching docs.

## Environment

- Use the local virtual environment only:

```bash
/Users/cliff/workspace/Synapse-Network/admin/gateway-admin/.venv/bin/python
```

- Do not assume system Python is correct.

## Validation

- Minimum backend validation command:

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
/Users/cliff/workspace/Synapse-Network/admin/gateway-admin/.venv/bin/python -m pytest tests/test_app.py -q
```

- Run additional targeted tests when repository or service logic changes.

## Operations

- Common local commands:

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
sh scripts/ops/start-local.sh
sh scripts/ops/stop.sh
sh scripts/ops/restart.sh
sh scripts/ops/status.sh
```

- If schema or bootstrap state is missing, use documented bootstrap or migration paths.
- Never hand-edit production-style tables to patch local state.

## Stop Conditions

- Stop and fix before finishing if any of these are true:
  - router contains business logic
  - service contains inline SQL
  - frontend must infer backend truth by itself
  - API contract changed without test updates
  - observable behavior changed without doc updates
