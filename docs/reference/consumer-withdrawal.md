# Consumer Balance Withdrawal — Design Reference

## Overview

Consumer withdrawal allows an owner to reclaim unused USDC from their consumer available balance back to their wallet. This is a pure off-chain balance refund — not a dispute refund. The destination is always the owner's own wallet.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/balance/consumer/withdraw` | Create a withdrawal intent |
| `GET`  | `/api/v1/balance/consumer/withdrawals` | List all withdrawals for the caller |

### POST `/api/v1/balance/consumer/withdraw`

**Request headers:**
- `X-Wallet-Address: <owner_address>`
- `Authorization: Bearer <token>`
- `X-Idempotency-Key: <client-generated unique key>`

**Request body:**
```json
{
  "amountUsdc": 5.0,
  "reason": "optional free-text reason"
}
```

**Response:**
```json
{
  "withdrawId": "uuid",
  "amountUsdc": 5.0,
  "status": "REQUESTED",
  "riskLevel": "green",
  "riskReasonCode": "",
  "message": "",
  "destination": "0x..."
}
```

---

## Withdrawal States

```
REQUESTED  ──(normal path)──►  COMPLETED
     │
     │ (large amount or daily cap exceeded)
     ▼
PENDING_MANUAL_REVIEW  ──(admin approves)──►  COMPLETED
                       └──(admin rejects)──►  REJECTED
```

| State | Meaning |
|-------|---------|
| `REQUESTED` | Intent created; balance reserved (available → pending) |
| `PENDING_MANUAL_REVIEW` | Requires admin review before processing |
| `COMPLETED` | Funds sent on-chain; pending released |
| `REJECTED` | Request denied; pending returned to available |

---

## Balance Flow

### On withdrawal creation (`REQUESTED`)

```
available_balance  -= amount
pending_balance    += amount
```

This is performed as an **atomic SQL delta** directly on `synapse_account_balances`, safe against concurrent full-ledger writes by the deposit indexer.

### On completion (`COMPLETED`)

```
pending_balance    -= amount
```

Funds are on-chain transferred; no available_balance change needed (it was already deducted at request time).

### On rejection (`REJECTED`)

```
available_balance  += amount
pending_balance    -= amount
```

Reserved amount is returned to available; owner may retry.

---

## Risk Classification

| Condition | Status | Risk Level |
|-----------|--------|------------|
| Amount < threshold AND daily count < limit | `REQUESTED` | `green` |
| Amount ≥ `CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC` | `PENDING_MANUAL_REVIEW` | `yellow` |
| Daily withdrawal count ≥ `CONSUMER_WITHDRAW_MAX_DAILY_COUNT` | `PENDING_MANUAL_REVIEW` | `red` |

---

## Constraints

- Minimum withdrawal: `CONSUMER_WITHDRAW_MIN_USDC` (default: $1 USDC)
- Daily limit before manual review: `CONSUMER_WITHDRAW_MAX_DAILY_COUNT` withdrawals
- Large amount threshold: `CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC`
- Only one active withdrawal (`REQUESTED` or `PENDING_MANUAL_REVIEW`) may exist at a time per owner. Duplicate requests return the existing intent.
- Idempotency: repeating the same request with the same `X-Idempotency-Key` returns the same response without side effects.

---

## Storage

| Table | Role |
|-------|------|
| `synapse_vault_withdrawals` | Persistent record with `withdrawal_kind='consumer_refund'` |
| `synapse_runtime_state` | JSON metadata at key `vault_withdrawal_meta::{id}` — stores `flowStatus`, `riskLevel`, `reason`, etc. |
| `synapse_account_balances` | Available/pending/frozen balances; updated atomically |

---

## Architecture Notes

### Why atomic SQL delta (not full-ledger write)?

The deposit indexer (`process_pending_deposit_intents_once`) periodically calls `write_balance_ledger`, which was designed to be the authoritative source for available balances derived from on-chain deposit events.

To prevent this from clobbering withdrawal-managed `pending_balance`:
1. `write_balance_ledger` now uses **available-only upsert** — it only updates `available_balance` and leaves `pending_balance`/`frozen_balance` untouched.
2. `reserve_consumer_balance_for_withdrawal` uses a direct `UPDATE ... SET available -= amount, pending += amount` with `WHERE available >= amount` for atomicity and safety.

This ensures both systems are independently safe:
- Deposit indexer can freely update available balance (representing confirmed on-chain deposits).
- Withdrawal system atomically manages pending balance independently.

---

## Payments Tab

Consumer withdrawals appear in the **Payments** tab (`/dashboard/billing/payments`) as `Withdraw` type entries. Status mapping:

| Withdrawal Status | Payments Display |
|-------------------|-----------------|
| `REQUESTED` | Pending (amber) |
| `PENDING_MANUAL_REVIEW` | Pending (amber) |
| `COMPLETED` | Succeeded (green) |
| `REJECTED` | Failed (red) |

Amount is shown as a negative value since this is an outflow from the vault.
