---
description: "Use when writing or modifying Python, FastAPI, repository, schema, service, migration, finance, provider_service, gateway, admin gateway, or sdk code. Covers Python 3.11 baseline, layering, data safety, tests, and docs sync."
applyTo:
  - "**/*.py"
name: "Synapse Python Rules"
---

# Synapse Python Rules

## Scope

- This file carries Python-specific coding rules for the whole workspace.
- Project role, runtime commands, and local exceptions stay in each subproject's AGENTS file.

## Runtime Baseline

- Python baseline is `3.11`.
- Respect each project's local environment instead of assuming system Python.
- When a subproject AGENTS file declares a specific interpreter or venv path, follow that path.

## Architecture

- Keep routers thin. Request parsing, dependency injection, and response mapping belong in routers only.
- Put orchestration, policy, validation, and workflow logic in service modules.
- Keep database access in repository or storage modules. Do not spread SQL across routers and services.
- Repository and storage interfaces should prefer typed domain objects over loose `dict` payloads; treat raw JSON as a serialization boundary, not the primary in-memory model.
- Use shared utility modules for reusable helpers such as time, hashing, serialization, and amount conversion.

Recommended split for backend services:

- `api/routers`: HTTP boundary only
- `api/schemas`: request and response schemas only
- `services`: orchestration and business policy
- `storage` or `repositories`: persistence only
- `core`: settings, logging, middleware, dependency wiring
- `utils`: small reusable helpers

## Modeling and Types

- Use Pydantic models for request and response contracts.
- Prefer explicit domain models over loose `dict[str, Any]` payloads for long-lived business data.
- When a storage layer persists structured records, model those records as typed objects instead of passing ad-hoc JSON-shaped dictionaries through the service stack.
- Keep field names, aliases, and error semantics stable unless the contract change is intentional and documented.

## Finance and Safety

- Use `Decimal` for money and settlement-sensitive arithmetic. Never use `float` for balances, fees, or settlement amounts.
- Validate all external input strictly. Reject negative amounts, malformed identifiers, and out-of-range enum or pagination values.
- Preserve idempotency, append-only audit trails, and transactional consistency on balance-changing paths.
- When calling external systems, use explicit timeouts and defensive error handling.

## FastAPI and Service Discipline

- Reuse `Depends(...)` for auth, role checks, and common request guards instead of re-parsing headers in each route.
- Return human-readable API errors. Do not leak stack traces, SQL internals, or secrets.
- Keep side effects explicit. If a service mutates balance, approval, or runtime state, make that path obvious and auditable.
- Do not hide schema bootstrap, auto-migration, or `CREATE TABLE` / `ALTER TABLE` side effects inside runtime repositories; keep DDL in explicit migrations or environment bootstrap SQL.

## Tests and Docs

- Any meaningful Python behavior change must update tests in the same change.
- Test business behavior and contract shape, not implementation trivia.
- If API fields, error codes, status transitions, or workflow semantics change, update the matching docs in the same change.
- Backward-incompatible changes require explicit documentation, not silent drift.

## Workspace-Specific Reminders

- `gateway`, `provider_service`, and `admin/gateway-admin` are not interchangeable runtimes. Preserve each service boundary.
- Gateway and finance-sensitive code paths must favor consistency and auditability over convenience.
- Provider runtimes should not absorb gateway settlement or admin-control-plane responsibilities.