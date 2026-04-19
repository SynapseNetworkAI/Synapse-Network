# BUG-FORUM-SUPPORT-SCHEMA-IDEMPOTENCY

**Status:** Fixed
**Area:** gateway-admin / forum support
**Date:** 2026-04-19

## Reproduction

Run gateway-admin against a database where `synapse_forum_response_tasks` already exists but indexes may be missing or stale, then call a Forum Support API that invokes `PostgresForumSupportRepository.ensure_schema()`.

## Root Cause

`ensure_schema()` returned early when `to_regclass('public.synapse_forum_response_tasks')` found the table. That skipped `CREATE INDEX IF NOT EXISTS` statements, so existing local or staging databases could miss the active-topic uniqueness guard and status ordering index.

## Fix

`ensure_schema()` now always executes the idempotent table and index DDL. The Postgres connection also uses a five-second connect timeout so admin support requests do not hang indefinitely when the database is unreachable.

## Verification

- `cd services/gateway-admin && .venv/bin/python -m pytest tests/test_app.py -k forum_support`

## Residual Risk

This is still runtime schema safety, not a substitute for explicit production migrations. Production rollout must continue to apply reviewed schema migrations before enabling `/forum-support`.
