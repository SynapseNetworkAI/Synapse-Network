# BUG-ADMIN-WITHDRAWAL-E2E-FLOAT-AMOUNT

## Summary

Provider withdrawal review responses could serialize `amountUsdc` through `float`, violating the repository money contract and causing strict money codecs to reject or round-trip the value unsafely.

## Reproduction

1. Create a provider withdrawal that enters manual review.
2. Load it through the admin withdrawal review path.
3. Observe the review/runtime response serializing the amount as a JSON number or failing where strict money parsing rejects float input.

## Root Cause

`WithdrawalDecision.amount_usdc` was typed as `Optional[float]`, and the Postgres finance atomic withdrawal repository converted `amount_usdc` with `float(amount)`.

## Fix

- `services/gateway/src/domain/execution.py` now types `WithdrawalDecision.amount_usdc` as `Decimal`.
- `services/gateway/src/storage/postgres/repositories/finance_atomic_withdraw_mixin.py` now preserves the Decimal/string money value instead of converting it to float.

## Verification

- `npm run e2e:admin-withdrawal-approval:seed`
- `npm run e2e:admin-withdrawal-approval:dogfood`
- `npm run e2e:admin-withdrawal-approval:reconcile`

The final reconciliation confirmed exact ticket and chain amounts:

- Expected ticket amount: `2000000000000000000`
- Actual ticket amount: `2000000000000000000`
- Provider chain delta: `2000000000000000000`
- Vault chain delta: `2000000000000000000`

## Residual Risk

The broader money scan remains the guardrail for preventing future float regressions. Any new withdrawal/review DTO must keep money as Decimal internally and string/atomic externally.
