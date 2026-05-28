# BUG-ANALYTICS-03: Deposit Confirm Path Missed `deposit_completed`

**Date:** 2026-04-16
**Status:** Fixed
**Surface:** Gateway analytics, consumer deposit, admin Analytics funnel

## Symptom

The ordered full-chain analytics E2E completed provider registration, consumer deposit, quote generation, and service invocation, but the ClickHouse event chain was missing `deposit_completed`. The admin Analytics data could therefore show invoke and revenue activity while the consumer activation funnel had a broken deposit step.

## Root Cause

`deposit_completed` was emitted only by the asynchronous deposit indexer path. At the time, a legacy explicit deposit confirm path could move pending deposit balance into available balance immediately. That synchronous confirm path updated the ledger and audit rows, but did not emit the analytics success event.

> 2026-05 security note: the legacy public confirm route is retired. Deposit confirmation is now indexer-owned and must be backed by verified on-chain receipt/event evidence.

## Fix

- Added a shared confirm-path analytics emit in `OwnerFinanceService.confirm_deposit_intent`.
- Reused the existing `emit_deposit_completed()` helper so the event schema stays identical to the indexer path: `amount_usdc`, `token_symbol`, and `tx_hash`.
- Added a unit regression test proving a successful explicit deposit confirmation emits `deposit_completed`.

## Verification

- `python -m pytest tests/unit/test_finance_runtime_service_unit.py -q`
- Re-run the ordered gateway analytics full-chain E2E and verify ClickHouse contains `deposit_completed` before comparing admin Analytics aggregates.
