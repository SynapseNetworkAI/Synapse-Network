# BUG-ADMIN-FORUM-SUPPORT-DDL-PERMISSION

**Status:** Fixed
**Area:** gateway-admin / forum support
**Date:** 2026-04-19

## Reproduction

1. Start `gateway-admin` with the normal local app DSN (`synapse_gateway_app`).
2. Log in as an admin.
3. Request `GET /api/admin/v1/forum/response-tasks`.
4. The response returns HTTP 500 and the log contains `psycopg.errors.InsufficientPrivilege: permission denied for schema public`.

## Root Cause

`PostgresForumSupportRepository.ensure_schema()` attempted to run table/index DDL from the authenticated API request path. The runtime database role has application DML permissions but not schema creation permissions, by design. That turned `/forum-support` from a read/write queue page into a privileged schema mutation path and produced 500s in production-like setups.

## Fix

`ensure_schema()` now performs a lightweight schema probe only. If `synapse_forum_response_tasks` is missing, gateway-admin logs a clear schema-missing error and tells operators to apply the reviewed bootstrap/migration. The Forum Support router also logs request id, task id, and filter context for list/send/ignore failures so future 500s are traceable.

## Verification

- `cd services/gateway-admin && .venv/bin/python -m pytest tests/test_app.py -k forum_support tests/test_forum_support_service.py tests/test_forum_support_repository.py`
- `npm run e2e:admin-front`

## Residual Risk

The fix intentionally does not create missing tables at runtime. Fresh local or staging databases still need explicit bootstrap/migration before Forum Support is enabled.
