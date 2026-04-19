# BUG-FORUM-SUPPORT-SCHEMA-IDEMPOTENCY

**Status:** Fixed
**Area:** gateway-admin / forum support
**Date:** 2026-04-19

## Reproduction

Run gateway-admin against a database where `synapse_forum_response_tasks` already exists but indexes may be missing or stale, then call a Forum Support API that invokes `PostgresForumSupportRepository.ensure_schema()`.

## Root Cause

`ensure_schema()` had drifted into runtime DDL. Earlier it returned too early and skipped indexes; after that was "fixed", it attempted `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` from the gateway-admin request path. Local and production-like app users intentionally do not have `CREATE` on `public`, so authenticated `/forum-support` requests could fail with `psycopg.errors.InsufficientPrivilege`.

## Fix

Runtime `ensure_schema()` now only probes `to_regclass('public.synapse_forum_response_tasks')`. If the table is missing, it logs a clear schema-missing error and raises a runtime error that points operators to the bootstrap/migration path. DDL remains owned by explicit Postgres bootstrap/migrations, not by gateway-admin request handling. The Postgres connection also uses a five-second connect timeout so admin support requests do not hang indefinitely when the database is unreachable.

## Verification

- `cd services/gateway-admin && .venv/bin/python -m pytest tests/test_app.py -k forum_support tests/test_forum_support_service.py tests/test_forum_support_repository.py`

## Residual Risk

If a staging or production database is missing the forum support table or indexes, `/forum-support` should fail loudly until reviewed migrations are applied. This is intentional: runtime app users should not silently mutate schema.
