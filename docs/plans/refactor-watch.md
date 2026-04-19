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

1. [WARN] `services/gateway/src/services/owner/downstream_concurrency.py::_record_outcome` line=344 metrics=(lines=95, branches=13, nesting=5, locals=13)
   - token: `hotspot-6df970994e40`
   - issues: `lines=95>40, branches=13>5, nesting=5>=4, locals=13>8, missing_guiding_comment`
   - bundle command: `amem refactor-bundle . --token hotspot-6df970994e40`
2. [WARN] `services/gateway/src/services/owner/finance_consumer_withdraw_mixin.py::FinanceConsumerWithdrawMixin.create_consumer_withdraw_intent` line=140 metrics=(lines=219, branches=20, nesting=4, locals=26)
   - token: `hotspot-ae22c6f3e3cb`
   - issues: `lines=219>40, branches=20>5, nesting=4>=4, locals=26>8, missing_guiding_comment`
   - bundle command: `amem refactor-bundle . --token hotspot-ae22c6f3e3cb`
3. [WARN] `services/gateway/src/storage/postgres/repositories/finance_atomic_repository.py::FinanceAtomicRepository.redeem_credit_voucher_atomic` line=52 metrics=(lines=292, branches=21, nesting=4, locals=36)
   - token: `hotspot-af1f8f002a9e`
   - issues: `lines=292>40, branches=21>5, nesting=4>=4, locals=36>8, missing_guiding_comment`
   - bundle command: `amem refactor-bundle . --token hotspot-af1f8f002a9e`
4. [WARN] `services/gateway/src/services/platform/service_health_probe.py::refresh_all_service_health` line=354 metrics=(lines=70, branches=9, nesting=4, locals=22)
   - token: `hotspot-765d965250dd`
   - issues: `lines=70>40, branches=9>5, nesting=4>=4, locals=22>8`
   - bundle command: `amem refactor-bundle . --token hotspot-765d965250dd`
5. [WARN] `services/gateway/examples/v2_daily_limit_regression.py::submit_and_wait_deposit_confirmation` line=228 metrics=(lines=50, branches=6, nesting=3, locals=11)
   - token: `hotspot-064f920a78ca`
   - issues: `lines=50>40, branches=6>5, locals=11>8, nesting=3, missing_guiding_comment`
   - bundle command: `amem refactor-bundle . --token hotspot-064f920a78ca`

## Suggested Action

1. Run `amem refactor-bundle .` to materialize the first hotspot into an executable planning bundle.
2. If a hotspot cannot be split yet, add a guiding comment that explains the main decision path and risk boundaries.
3. Re-run `amem doctor .` after the change and confirm `refactor_watch` findings shrink or disappear.
