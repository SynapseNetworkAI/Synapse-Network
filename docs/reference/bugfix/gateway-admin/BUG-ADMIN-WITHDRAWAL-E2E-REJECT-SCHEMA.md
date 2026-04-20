# BUG-ADMIN-WITHDRAWAL-E2E-REJECT-SCHEMA

## Summary

The provider withdrawal review API accepted `APPROVE` but rejected `REJECT` at schema validation before reaching the review state machine.

## Reproduction

1. Approve a provider withdrawal in `/withdrawal-reviews`.
2. Send a second decision request with `decision=REJECT`.
3. Before the fix, gateway-admin returned a validation error because the schema required `decision` to be at least 7 characters. `REJECT` is 6 characters.

## Root Cause

`ProviderWithdrawReviewDecisionRequest.decision` used `min_length=7`, which accidentally matched `APPROVE` but excluded the valid `REJECT` decision.

## Fix

`services/gateway-admin/src/api/schemas/provider_withdraw_review.py` now uses `min_length=6`, allowing both valid decision values to reach service-level validation.

## Verification

After restarting gateway-admin, the full admin withdrawal approval E2E produced:

- duplicate approval rejected: `400`
- cross reject after approve rejected: `400`
- no extra ticket generated
- no second balance movement

Evidence:

- `output/dogfood/admin-withdrawal-approval/2026-04-20T075941909Z/reconciliation-report.md`

## Residual Risk

Future decision schemas should prefer enum/literal validation over length-based validation so allowed operational actions cannot be accidentally excluded.
