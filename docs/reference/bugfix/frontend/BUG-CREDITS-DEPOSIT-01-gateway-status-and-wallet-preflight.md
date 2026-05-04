# BUG-CREDITS-DEPOSIT-01: Gateway deposit status and wallet preflight

**Status:** Fixed
**Date:** 2026-05-04
**Component:** `services/user-front` Credits and Billing deposit UX

## Symptom

Credits showed `$0.00` spendable balance after two 100 USDC deposits, while Billing displayed those deposit rows as `Completed`.

Read-only SQL showed the real state:

- `synapse_vault_deposits.status = PENDING_CONFIRMATION`
- `synapse_account_balances.available_balance = 0`
- `synapse_account_balances.pending_balance = 200`

## Root Cause

The Billing table mapped on-chain `DepositInfo` logs directly to `COMPLETED`. That confused chain evidence with Gateway ledger truth. A transaction can exist on-chain while the Gateway deposit intent is still pending confirmation, so it is not yet spendable.

The deposit flow also warned about low native gas without hard-blocking before wallet prompts.

## Fix

1. Credits now shows separate `Spendable credits`, `Pending / syncing credits`, and `Frozen / review credits`.
2. Billing Deposit rows use Gateway deposit intent status as the business state source.
3. Chain logs without confirmed Gateway intent render as `Pending / Syncing`, not `Completed`.
4. Deposit preflight blocks before MetaMask prompts when amount, wallet USDC, or native gas is insufficient.
5. Token decimals are read from the USDC contract instead of assuming 18 decimals.

## Regression Rule

Money completion in frontend UI must come from Gateway balance, ledger, or intent state. Chain logs and explorer links are evidence, not spendable balance truth.

Wallet signature or transaction prompts must not open when local preflight already proves insufficient USDC or gas.

## Validation

```bash
cd services/user-front && yarn test src/hooks/useVaultDeposit.test.tsx src/hooks/useFundsData.test.tsx src/components/dashboard-workspace/OwnerCreditsPage.test.tsx src/components/dashboard-workspace/OwnerBillingPage.test.tsx
cd services/user-front && yarn lint
cd services/gateway && .venv/bin/python -m pytest tests/unit/test_auth_challenge_unit.py -q
npm run ci:docs
npm run ci:format-check
```
