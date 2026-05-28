# BUG-FINANCE-05: Deposit / Withdraw Chain Evidence Hardening

**Date:** 2026-05-28
**Status:** Fixed
**Surface:** Gateway deposit confirmation, consumer withdrawal, provider withdrawal, user-front wallet checks

## Symptom

A security review of `main` found three finance-path hazards:

- A public owner-authenticated deposit confirm route could move a deposit intent from pending to available using client-provided `eventKey` and `confirmations`.
- Withdrawal ticket signing and vault-liquidity checks assumed USDC had 18 decimals, which is false for production Arbitrum One USDC.
- Withdrawal completion accepted a syntactically valid `txHash` before moving pending funds and marking the withdrawal completed.
- Consumer withdrawal creation could reserve pending/frozen funds before the withdrawal row was durably written, which could leave funds locked if the row write failed.

## Root Cause

The Gateway trusted client-provided chain metadata on terminal money transitions. Local MockUSDC also hid a production precision mismatch because it uses 18 decimals while production USDC uses 6. One legacy consumer withdrawal path also split balance reservation and row persistence without compensation on the row-write failure path.

## Fix

- Retired the public deposit confirm route. Deposit confirmation is indexer-owned and must be backed by receipt/event evidence.
- Withdrawal atomic conversion now reads token `decimals()` before signing tickets or checking vault liquidity.
- Consumer and provider withdrawal completion verifies the transaction receipt, SynapseCore target, `WithdrawInfo` event, owner, amount, fee, and ticket hash before moving pending funds or marking completion.
- Frontend provider withdrawal liquidity checks now read token `decimals()` instead of hardcoding 18.
- Consumer withdrawal creation releases reserved pending/frozen funds if the withdrawal row write fails, preventing a locked-balance-with-no-row state.

## Prevention

- `.github/instructions/finance-backend.instructions.md` now requires chain receipt/event evidence before chain-backed money state changes.
- `.github/instructions/frontend.instructions.md` now forbids hardcoded production USDC decimals in wallet money flows.
- `docs/reference/Money_Contract.md` records chain evidence and token-decimal rules as canonical money-contract constraints.
- Finance backend instructions now require withdrawal row creation and balance reservation to be atomic or to have tested compensation.

## Verification

- `cd services/gateway && .venv/bin/python -m pytest tests/unit/test_balance_notification_router_unit.py tests/unit/test_finance_runtime_service_unit.py tests/unit/test_consumer_withdraw_unit.py -q`
- `cd services/user-front && yarn test src/components/provider-workspace/ProviderWithdrawPage.test.tsx src/components/provider-workspace/ProviderSettlementsPage.test.tsx`
- `npm run ci:docs`
