# BUG-FRONT-DEPOSIT-COMPLETED-BALANCE-ZERO

## Status

Fixed locally and covered by `npm run e2e:user-front-deposit-balance`.

## Symptom

The Billing page could show a wallet deposit as `Completed` while the Credits balance still showed `$0.00`.

Local SQL showed the affected deposit rows were still `PENDING_CONFIRMATION` in `synapse_vault_deposits`, with funds in `synapse_account_balances.pending_balance` and no increase to `available_balance`.

## Root Cause

`useFundsData` built deposit ledger rows directly from on-chain `DepositInfo` logs and marked every matching chain log as `COMPLETED`. That treated "chain transaction confirmed" as "Gateway deposit confirmed", even when the Gateway deposit intent had not moved funds from pending to available.

## Fix

- Billing now loads Gateway deposit intents and merges them by `txHash`.
- Deposit status is mapped from Gateway state:
  - `CONFIRMED` -> `COMPLETED`
  - `PENDING_CONFIRMATION` / `PENDING` / missing intent -> `PENDING`
  - failure states -> `FAILED`
- Credits continues to use `GET /api/v1/balance` as the balance source of truth.
- The deposit-balance E2E validates pending and final states with DOM, screenshots, API, SQL balance rows, deposit rows, audit rows, and replay checks.

## Verification

- `cd services/user-front && yarn test useFundsData OwnerBillingPage useVaultDeposit`
- `npm run e2e:user-front-deposit-balance`
- `npm run ci:user-front-deposit-balance-evidence`
