---
description: "Use when writing or modifying Python, FastAPI, repository, schema, service, migration, finance, provider_service, gateway, admin gateway, or sdk code. Covers Python 3.13 baseline, layering, data safety, tests, and docs sync."
applyTo:
  - "**/*.py"
name: "Synapse Python Rules"
---

# Synapse Python Rules

## Scope

- This file carries Python-specific coding rules for the whole workspace.
- Project role, runtime commands, and local exceptions stay in each subproject's AGENTS file.

## Runtime Baseline

- Python baseline is `3.13`.
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
- Public service/API/storage functions must return typed objects, not raw map contracts such as `dict`, `dict[str, Any]`, `Dict[str, Any]`, or `Mapping[str, Any]`. Use frozen dataclasses for internal service results and convert to Pydantic/JSON only at the router or serializer boundary.
- Typed projection/read-model queries must preserve database-native types. Do not use SQL-side JSON flattening such as `row_to_json` for projection views; query explicit columns and map rows into dataclasses in the repository/data-mapper layer.
- Keep field names, aliases, and error semantics stable unless the contract change is intentional and documented.
- **No bare `dict[str, Any]` in internal service function signatures or as mutation specs.** When a function requires more than 4 optional kwargs representing a logical update, define a typed Pydantic model as the patch/update object (e.g. `CredentialPatch`) and pass it as a single argument. See `src/domain/identity.py:CredentialPatch` for the established pattern.
- **Use built-in generic types, not `typing` aliases.** Python 3.9+ allows `dict[str, ...]`, `list[...]`, `tuple[...]`, `set[...]` directly. Never import or use `typing.Dict`, `typing.List`, `typing.Tuple`, `typing.Set`. Use `from __future__ import annotations` at the top of the file to support this even in older forward-reference contexts.

## File Size Discipline

- **New runtime Python files should stay below 500 effective lines.** Test-like files should stay below 800 effective lines.
- **Runtime Python functions should stay below 80 effective lines.** If a function crosses that boundary, first extract private helpers with names that describe the sub-decision or transformation.
- Split modules only when the responsibility boundary is clear, such as `scanner`, `runner`, `serializer`, `adapter`, `client`, or `policy`. Do not create meaningless fragments only to satisfy a line-count gate.
- Existing baseline files are ratcheted by `npm run ci:quality-budget`; do not grow them casually. Preserve backwards compatibility via re-exports when a large public module is split.
- See `docs/reference/Engineering_Quality_Guardrails.md` for the full quality-budget policy and refactoring playbook.

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

- `gateway`, `provider_service`, and `services/gateway-admin` are not interchangeable runtimes. Preserve each service boundary.
- Gateway and finance-sensitive code paths must favor consistency and auditability over convenience.
- Provider runtimes should not absorb gateway settlement or admin-control-plane responsibilities.

## ⚠️ Gotchas

- **[`2026-03-26-synapse-002`]** 持久化 Pydantic 模型时，若将来可能改 alias 或字段名， 要么在序列化时固定字段名（禁用 alias），要么在反序列化层加兼容性适配。 不要假设历史数据与当前 schema 格式永远一致。
  <!-- auto-synced from agents-memory --> — Known Python / FastAPI Failure Patterns

**Layering leaks**

- Raw SQL or `session.execute()` calls inside a router function — these belong exclusively in repository/storage modules.
- Business-rule conditionals (e.g., balance check, status gate) scattered inside routers instead of service modules.

**Pydantic v2 migration traps**

- Calling `.dict()` instead of `.model_dump()` on Pydantic v2 models — `.dict()` is deprecated and silently returns wrong alias behavior.
- Using `from __future__ import annotations` in files that define Pydantic v1 validators — breaks at runtime without an obvious traceback.

**FastAPI dependency anti-patterns**

- Instantiating a database session or repository directly inside a route function instead of via `Depends(get_db)`. Creates untraceable session leaks.
- Per-request state stored in a module-level global instead of in `request.state` or a proper dependency.

**Test hygiene**

- Writing tests that patch the wrong import path (patch the symbol where it is _used_, not where it is _defined_).
- Tests that only assert happy-path 200 responses and skip schema-shape assertions — downstream consumers regress silently when fields shift.

**Service boundary violations**

- `gateway` code importing directly from `provider_service` modules — inter-service communication must go through the API layer.
- `services/gateway-admin` writing balance mutations directly instead of delegating to the settlement runtime.
