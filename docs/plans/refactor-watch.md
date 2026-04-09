# Refactor Watch

- Project: `synapse-network`
- Root: `/Users/cliff/workspace/agent/Synapse-Network`

## Purpose

Track Python functions that are already high-complexity or are approaching the configured refactor thresholds.

## Thresholds

- Hard gate: more than 40 effective lines, more than 5 control-flow branches, nesting depth >= 4, or more than 8 local variables.
- Watch zone: around 30 effective lines, 4 branches, nesting depth 3, or 6 local variables.
- Complex logic should include a short guiding comment when it cannot be cleanly decomposed yet.

## Workflow Entry

- Primary command: `amem refactor-bundle .`
- Prefer stable targeting with: `amem refactor-bundle . --token <hotspot-token>`
- Fallback positional targeting: `amem refactor-bundle . --index <n>`
- The command creates or refreshes `docs/plans/refactor-<slug>/` using the first current hotspot as execution context.

## Hotspots

1. [WARN] `services/gateway/src/storage/postgres/repositories/finance_atomic_repository.py::FinanceAtomicRepository.redeem_credit_voucher_atomic` line=52 metrics=(lines=292, branches=21, nesting=4, locals=36)
   - token: `hotspot-af1f8f002a9e`
   - issues: `lines=292>40, branches=21>5, nesting=4>=4, locals=36>8, missing_guiding_comment`
   - bundle command: `amem refactor-bundle . --token hotspot-af1f8f002a9e`
2. [WARN] `services/gateway/src/services/owner/finance_consumer_withdraw_mixin.py::FinanceConsumerWithdrawMixin.create_consumer_withdraw_intent` line=98 metrics=(lines=203, branches=15, nesting=4, locals=31)
   - token: `hotspot-ae22c6f3e3cb`
   - issues: `lines=203>40, branches=15>5, nesting=4>=4, locals=31>8`
   - bundle command: `amem refactor-bundle . --token hotspot-ae22c6f3e3cb`
3. [WARN] `services/gateway/src/storage/postgres/repositories/idempotency_repository.py::IdempotencyRepository.read_idempotency_rows` line=73 metrics=(lines=59, branches=4, nesting=4, locals=14)
   - token: `hotspot-230b7cdcfbe3`
   - issues: `lines=59>40, nesting=4>=4, locals=14>8, branches=4, missing_guiding_comment`
   - bundle command: `amem refactor-bundle . --token hotspot-230b7cdcfbe3`
4. [WARN] `services/gateway/src/storage/postgres/repositories/balance_repository.py::BalanceRepository.read_balance_ledger` line=136 metrics=(lines=61, branches=5, nesting=4, locals=14)
   - token: `hotspot-27d7dd41486f`
   - issues: `lines=61>40, nesting=4>=4, locals=14>8, branches=5, missing_guiding_comment`
   - bundle command: `amem refactor-bundle . --token hotspot-27d7dd41486f`
5. [WARN] `services/gateway/src/services/platform/tasks/deposit_indexer/backfill.py::run_backfill_scan_once` line=113 metrics=(lines=116, branches=8, nesting=3, locals=22)
   - token: `hotspot-447cc31b8594`
   - issues: `lines=116>40, branches=8>5, locals=22>8, nesting=3, missing_guiding_comment`
   - bundle command: `amem refactor-bundle . --token hotspot-447cc31b8594`
6. [WARN] services/gateway/src/services/platform/tasks/deposit_indexer/backfill.py::run_backfill_scan_once high complexity (lines=116>40, branches=8>5, locals=22>8, nesting=3, missing_guiding_comment)

## Suggested Action

1. Run `amem refactor-bundle .` to materialize the first hotspot into an executable planning bundle.
2. If a hotspot cannot be split yet, add a guiding comment that explains the main decision path and risk boundaries.
3. Re-run `amem doctor .` after the change and confirm `refactor_watch` findings shrink or disappear.
