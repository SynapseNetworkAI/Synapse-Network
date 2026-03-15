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
# Seller API
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
