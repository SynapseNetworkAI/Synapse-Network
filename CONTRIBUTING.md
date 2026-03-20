# Contributing to Synapse Network

This project enforces docs-code-test consistency for safe iteration and regression control.

## Core Rule

For every backend behavior change, your PR must include:
1. Code changes
2. Matching unit/integration test updates
3. Documentation updates for any external behavior or contract change

No exceptions for routes, schemas, service logic, or persistence behavior.

## Backend Change Checklist

When you modify backend files under `gateway/src/` or `provider_service/app/`:
1. Update or add tests in the corresponding test module.
2. Cover success path and at least one failure/edge branch.
3. Sync affected API docs and field semantics.
4. Run relevant tests locally before commit.

Suggested command examples:

```bash
# Provider API
python -m pytest -q gateway/tests

# Provider service
cd provider_service
.venv/bin/python -m pytest -q tests
```

## Docs-Code-Test Consistency Gate

A backend PR is considered complete only when all three are aligned:
1. Docs reflect actual runtime behavior.
2. Code implements the documented contract.
3. Tests assert that contract and fail if it regresses.

If one side is missing, the change is incomplete.

## Frontend Change Checklist

When you modify frontend files under `apps/frontend/src/`:
1. Update or add tests for any shared logic or behavior that changed.
2. Run the repository frontend CI gate from repo root.

That gate currently executes frontend `lint + test + build`.

Suggested command:

```bash
npm run ci:frontend
```

## Repository PR Gate

Use the repository PR aggregate command before pushing cross-cutting changes:

```bash
npm run ci:pr
```

Current `ci:pr` coverage:
1. `apps/frontend`: lint, test, build
2. `admin/admin-front`: lint, build
3. `gateway`: create `gateway/.venv`, install project deps, run pytest
4. `admin/gateway-admin`: create `admin/gateway-admin/.venv`, install project deps, run pytest
5. `provider_service`: create `provider_service/.venv`, install project deps, run pytest
6. `sdk/python`: create `sdk/python/.venv`, install editable package deps, run pytest unit coverage and `python -m build`
7. root contracts: hardhat compile, and hardhat test when root test files exist

Current Python packaging scope in this repository:
1. `sdk/python` is the only Python project that is currently packaged and validated with `python -m build`.
2. `gateway`, `admin/gateway-admin`, and `provider_service` are service runtimes, not distribution packages.

CI Python environment rule:
1. The Python CI scripts do not rely on an externally activated interpreter anymore.
2. Each Python project bootstraps and uses its own directory-local `.venv` during the check.

## Commit Hygiene

1. Keep commits focused and reviewable.
2. Include docs and tests in the same PR if behavior changed.
3. Avoid dead code and stale tests after refactor.
4. Push only after passing the relevant test subset.

## Security Reminder

For financial and credential-sensitive flows:
1. Validate all inputs strictly.
2. Never rely only on client-provided identity fields.
3. Include idempotency/replay tests when modifying payment paths.
4. Keep auditability fields and request tracing intact.
