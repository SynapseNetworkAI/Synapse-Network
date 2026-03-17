# Backend Unit Testing Guide

This guide defines how backend tests should be organized for refactor safety and financial regression control.

## 1. Goals

1. Keep docs, code, and tests aligned.
2. Make financial and runtime behavior regression-safe.
3. Separate unit, integration, and performance concerns.

## 2. Coverage Priorities

At minimum, cover:

1. Owner-scoped auth and isolation
2. Agent credential and budget enforcement
3. Deposit idempotency and confirmation
4. Gateway forwarding success and failure branches
5. Consumer charge capture and rollback
6. Provider receivable accrual and withdrawal review paths
7. Audit emission and runtime state persistence

## 3. Naming Rule

Prefer business-intent names such as:

1. `test_confirm_deposit_moves_consumer_pending_to_available`
2. `test_invoke_capture_accrues_provider_receivable`
3. `test_withdrawal_yellow_path_moves_receivable_to_locked`

## 4. Execution Commands

```bash
cd gateway
python -m pytest -q tests/unit
python -m pytest -q tests/integration -m "not performance"
RUN_PERF_TESTS=1 python -m pytest -q tests/performance -m performance
```

## 5. E2E Critical Path

The canonical end-to-end path is now:

1. Owner funds vault
2. Deposit confirms into consumer balance
3. Agent invokes service through gateway
4. Platform captures charge and accrues provider receivable
5. Provider withdrawal path enters risk decision and, when needed, manual review
