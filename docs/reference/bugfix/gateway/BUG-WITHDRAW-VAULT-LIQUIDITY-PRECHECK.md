# BUG-WITHDRAW-VAULT-LIQUIDITY-PRECHECK

## Summary

Consumer withdrawal creation only validated Gateway ledger balance before locking funds and signing a ticket. If local chain state drifted and `SynapseCore` held less USDC than the requested withdrawal, the request could enter `REQUESTED` with funds locked in pending, then fail later during the wallet `withdraw(...)` call.

## Root Cause

The Provider withdrawal path already checked on-chain vault liquidity before reserve/signing, but the Consumer withdrawal path did not. Local development made the gap visible because Hardhat chain resets can leave Postgres balances ahead of the on-chain vault balance.

## Fix

- Consumer withdrawal creation now checks `USDC.balanceOf(SynapseCore)` before balance lock or ticket signing.
- Manual-review Consumer approval checks vault liquidity before moving frozen funds to pending or signing a ticket.
- Insufficient vault liquidity returns `400 VAULT_LIQUIDITY_INSUFFICIENT`; unavailable RPC/liquidity check returns `503 WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE`.
- Billing copy now shows pending withdrawals as withdrawal processing, not deposit syncing.
- Local vault drift can be repaired with `npm run dev:vault:top-up -- <amountUsdc>`, which only runs on local Hardhat/Anvil chain IDs.

## Local Recovery

Expired tickets cannot be resumed after topping up liquidity. For a stale local withdrawal, release or expire the old pending row first, top up local `SynapseCore` liquidity, then create a fresh withdrawal:

```bash
npm run dev:vault:top-up -- 500 --dry-run
npm run dev:vault:top-up -- 500
```

## Verification

- `cd services/gateway && .venv/bin/python -m pytest tests/unit/test_consumer_withdraw_unit.py -q`
- `cd services/gateway && .venv/bin/python -m pytest tests/unit/test_provider_withdraw_policy_unit.py tests/unit/test_finance_runtime_service_unit.py -q`
- `cd services/user-front && yarn test OwnerBillingPage.test.tsx`
- `node --check scripts/local/top_up_local_vault_liquidity.mjs`
- `npm run dev:vault:top-up -- 500 --dry-run`
