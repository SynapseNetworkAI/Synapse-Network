# Consumer Balance Withdrawal — Design Reference

## Overview

Consumer withdrawal lets an owner reclaim unused USDC from the consumer treasury back to the same wallet that owns the balance. This is not a dispute refund and it never touches provider receivables.

The runtime model is:

- Gateway validates balance, risk, idempotency, and active-withdrawal rules.
- Gateway reserves treasury balance immediately.
- Gateway signs an EIP-712 withdrawal ticket for `REQUESTED` rows.
- Frontend asks the owner wallet to execute `SynapseCore.withdraw(...)`.
- `/api/v1/refunds/{refundId}/complete` closes the happy path.
- `consumer-withdraw-chain-recovery` is only a low-frequency safety net for missed completion callbacks.
- `withdrawal-expiry-sweeper` is the time-driven release path for manual-review expiry and ticket expiry.

## Endpoints

| Method | Path                                      | Description                                                     |
| ------ | ----------------------------------------- | --------------------------------------------------------------- |
| `POST` | `/api/v1/balance/consumer/withdraw`       | Create or resume a consumer withdrawal intent                   |
| `GET`  | `/api/v1/balance/consumer/withdrawals`    | List consumer withdrawals for the caller                        |
| `POST` | `/api/v1/refunds/{refundId}/complete`     | Mark a wallet-confirmed withdrawal `COMPLETED`                  |
| `POST` | `/api/v1/refunds/{refundId}/fail`         | Mark a failed wallet flow `FAILED` and release reserved balance |
| `POST` | `/api/v1/admin/refunds/{refundId}/review` | Approve or reject a `PENDING_MANUAL_REVIEW` consumer withdrawal |

## Statuses

```text
REQUESTED
  -> COMPLETED
  -> FAILED
  -> CANCELLED

PENDING_MANUAL_REVIEW
  -> REQUESTED
  -> REJECTED
  -> FAILED
```

| Status                  | Meaning                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `REQUESTED`             | Auto-approved. Balance already moved from available to pending. Ticket is ready for wallet execution.     |
| `PENDING_MANUAL_REVIEW` | Balance already moved from available to frozen. No wallet ticket is exposed yet.                          |
| `COMPLETED`             | On-chain `withdraw()` succeeded and pending balance has been consumed.                                    |
| `FAILED`                | Wallet rejected, receipt failed, or the client explicitly reported failure. Reserved balance is released. |
| `REJECTED`              | Admin denied a manual-review withdrawal. Frozen balance is released.                                      |
| `FAILED_EXPIRED`        | Ticket expired or manual review exceeded 24h. Reserved balance is released.                               |

## Balance Transitions

All amounts below refer to the gross requested amount from the consumer treasury.

| Transition                               | available  | pending    | frozen     |
| ---------------------------------------- | ---------- | ---------- | ---------- |
| Create `REQUESTED`                       | `- amount` | `+ amount` | no change  |
| Create `PENDING_MANUAL_REVIEW`           | `- amount` | no change  | `+ amount` |
| Review `APPROVE`                         | no change  | `+ amount` | `- amount` |
| Review `REJECT`                          | `+ amount` | no change  | `- amount` |
| `/complete` or watcher completion        | no change  | `- amount` | no change  |
| `/fail` from `REQUESTED`                 | `+ amount` | `- amount` | no change  |
| `/fail` from `PENDING_MANUAL_REVIEW`     | `+ amount` | no change  | `- amount` |
| Manual review expiry -> `FAILED_EXPIRED` | `+ amount` | no change  | `- amount` |
| Ticket expiry -> `FAILED_EXPIRED`        | `+ amount` | `- amount` | no change  |

### Failure Semantics

When a withdrawal fails:

- the row status becomes `FAILED`
- the gateway stores the failure reason code and optional `txHash`
- reserved funds are released back to `available_balance`
- the owner may start a new withdrawal after the failed row is no longer active

This is the fix for the earlier bug where the UI could report a failed flow while the treasury balance remained stuck.

## Maturity And Dust Rules

Consumer withdrawals have two hard pre-checks before any row is created:

- `amountUsdc < 10` returns `400 MIN_WITHDRAWAL_AMOUNT_NOT_MET`.
- When `CONSUMER_WITHDRAW_MATURITY_ENFORCEMENT_ENABLED=true`, recent deposits are spendable inside Synapse immediately, but withdrawable only after 7 days.
- Local development defaults this enforcement to `false` so tests can withdraw newly seeded balances; staging/prod default to `true`, and prod startup refuses `false`.

The mature amount uses an aggregate FIFO formula instead of per-deposit withdrawal labels:

```text
matureWithdrawable = max(0,
  depositsConfirmedBefore7d
  - lifetimeConsumerSpend
  - lifetimeConsumerWithdrawnOrLocked
)
```

If `amountUsdc` is greater than `matureWithdrawable`, Gateway returns `400 INSUFFICIENT_MATURE_CONSUMER_BALANCE`. Dust failures and immature-funds failures do not create withdrawal rows, do not sign tickets, and do not send Lark alerts.

When maturity enforcement is disabled, Gateway still applies minimum amount, available-balance, vault-liquidity, idempotency, risk, lock, ticket, and audit checks; only the T+7 mature-balance pre-check is bypassed.

The 24h count risk gate is a database timestamp sliding window (`created_at >= NOW() - INTERVAL '24 hours'`), not a natural-day reset.

## Active-Withdrawal Rule

Only one active consumer withdrawal is allowed per owner at a time.

Active statuses are:

- `REQUESTED`
- `PENDING`
- `APPROVED_AUTO`
- `TICKET_READY`
- `PENDING_MANUAL_REVIEW`

If the owner sends another `POST /api/v1/balance/consumer/withdraw` while one of those rows exists:

- no new row is created
- no second balance deduction happens
- the existing row is returned
- if the row is `REQUESTED`, the response includes the already-issued signed ticket metadata

## Idempotency And Concurrency Evidence

Consumer withdrawal correctness is validated by separate E2E suites with narrow
ownership:

```bash
npm run e2e:withdrawal-risk-policy
npm run e2e:withdrawal-idempotency-concurrency
npm run ci:withdrawal-idempotency-concurrency-evidence
```

`withdrawal-risk-policy` covers Dust, T+7 maturity, aggregate FIFO,
24h sliding-window risk classification, and normal withdrawals through final
`COMPLETED` status. It does not claim to cover every manual-review UI path.

`withdrawal-idempotency-concurrency` proves the money invariants under
parallel requests:

- concurrent create requests reserve funds once
- same idempotency key and same payload returns the same result
- same idempotency key with a different payload returns `409 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`
- concurrent approve signs one ticket and moves frozen to pending once
- concurrent reject releases frozen to available once
- approve/reject races settle into one legal terminal branch
- concurrent complete consumes pending once and preserves the first `txHash`
- consumed `ticketHash` cannot be replayed on-chain

Broad money-path changes must also pass the unified local finance gate:

```bash
npm run e2e:money-safety-concurrency:local
npm run ci:money-safety-concurrency-local-evidence
```

That gate aggregates deposit replay, consumer/provider withdrawal concurrency,
refund callback replay, invoke hold/capture/release, and platform fee boundary
evidence into one bundle.

Manual-review UI, admin permissions, screenshots, and approve/reject operations
remain covered by `withdrawal-review-dogfood` and `admin-withdrawal-approval`.

The full local consumer self-claim path now has its own money-path evidence
lane:

```bash
npm run e2e:consumer-withdraw-claim-fullchain:local
npm run ci:consumer-withdraw-claim-fullchain-local-evidence
```

That gate proves one continuous story:

1. deposit is credited to Gateway balance
2. a risky withdrawal enters `PENDING_MANUAL_REVIEW`
3. admin approval transitions the row to `REQUESTED + claimable=true`
4. User-front changes from `审核中` to `待领取`
5. the consumer wallet executes the real `SynapseCore.withdraw(...)` claim
6. Gateway `/complete` or watcher closes the row as `COMPLETED`
7. `platformFeePool` increases by the signed fee
8. a local owner-only `withdrawPlatformFees(amount)` can withdraw only that accrued fee into the platform wallet

This is intentionally local-only automation. Staging and production keep the
same self-claim consumer path, but platform fee execution remains a controlled
Safe or owner operation rather than a generic automated CI step.

Approved-ticket expiry and release has its own local gate:

```bash
npm run e2e:consumer-withdraw-approval-expiry:local
npm run ci:consumer-withdraw-approval-expiry-local-evidence
```

That gate proves a second continuous story:

1. a risky withdrawal enters `PENDING_MANUAL_REVIEW`
2. admin approval transitions it to `REQUESTED + claimable=true`
3. User-front shows the ready-to-continue wallet state
4. the ticket is allowed to approach physical expiry
5. User-front changes to an expiring-warning state instead of encouraging a late claim
6. after the local expiry buffer and RPC finality margin pass, `consumer_withdraw_processor` marks the row `FAILED_EXPIRED`
7. pending balance is released back to withdrawable balance
8. wallet balance, vault balance, and `platformFeePool` remain unchanged because no on-chain claim occurred

## Ticket and Fee Model

- `CONSUMER_WITHDRAW_FEE_USDC` is deducted from the requested amount.
- The ticket signs the net transfer amount and the fee separately.
- The wallet executes `SynapseCore.withdraw(net, fee, ticketId, deadline, signature)`.
- Each withdrawal request has a single ticket lifecycle. If the ticket expires before the chain claim, Gateway closes the request as `FAILED_EXPIRED`, releases the funds, and the user must create a fresh withdrawal request.
- Manual-review withdrawals have a 24h SLA (`WITHDRAWAL_MANUAL_REVIEW_EXPIRY_SEC=86400`). If review does not happen in time, the processor marks the row `FAILED_EXPIRED`, releases frozen funds back to available balance, and sends user notification copy that explicitly says the funds were safely returned.
- Admin `/withdrawal-reviews` must expose a review expiration timestamp equal to `created_at + WITHDRAWAL_MANUAL_REVIEW_EXPIRY_SEC`.
- Once a manual-review withdrawal passes that expiration timestamp, it must not remain in the active `/withdrawal-reviews` queue even if the expiry reaper has not yet persisted `FAILED_EXPIRED`. Queue visibility is UX truth; final bucket release still waits for backend status transition.
- Expiry processors are batch-limited (`WITHDRAWAL_REAPER_BATCH_SIZE=100` by default) so historical queues are drained over multiple short transactions instead of one lock-heavy sweep.

The owner receives the net amount on-chain. The fee stays inside the vault as protocol revenue.

Platform revenue is not transferred to the platform wallet at claim time.
Instead:

1. consumer claim sends only the signed net amount to the user wallet
2. the signed fee remains inside `SynapseCore` as `platformFeePool`
3. a separate owner-only `withdrawPlatformFees(amount)` call moves that accrued fee to the platform wallet

This is the key custody boundary that prevents the platform from directly
pulling user principal during ordinary withdrawal completion.

## Payments Page Behavior

Consumer withdrawals appear in Payments as a single `Withdraw` row. We intentionally filter the same rows out of generic refund history to avoid duplicates.

Payments is a Gateway-backed display surface, not a frontend chain watcher. The page reads persisted Gateway rows for deposit intents, consumer withdrawals, and refunds, then performs display-only `concat + sort` in the browser with a large per-source limit. It must not scan `WithdrawInfo` or `DepositInfo` logs to create ledger rows or mark a payment completed.

Status mapping:

| Withdrawal Status       | Payments Status  |
| ----------------------- | ---------------- |
| `REQUESTED`             | `READY_TO_CLAIM` |
| `PENDING_MANUAL_REVIEW` | `UNDER_REVIEW`   |
| `COMPLETED`             | `COMPLETED`      |
| `FAILED`                | `FAILED`         |
| `REJECTED`              | `FAILED`         |
| `FAILED_EXPIRED`        | `FAILED`         |

Other display rules:

- `REQUESTED` must render as a wallet action surface, not a generic "processing" placeholder
- `PENDING_MANUAL_REVIEW` means the ticket is not released yet and the wallet cannot claim
- amount is shown as a negative outflow
- `txHash` is shown once it exists
- failed or cancelled withdrawals keep their failure state instead of disappearing
- page refreshes recover pending rows from Gateway state, not from local optimistic UI
- E2E screenshot and DOM checkpoints for a successful withdrawal must assert `Completed` after the complete callback, not merely `Pending` or ticket-ready state

## Watcher Role

`consumer_withdraw_processor.py` is not an executor.

It only does two recovery jobs:

1. detect a matching on-chain `WithdrawInfo` event for a `REQUESTED` row and mark it `COMPLETED`
2. detect an expired ticket with no on-chain execution and mark it `FAILED_EXPIRED`

This watcher exists to recover from frontend interruption after ticket issuance or after on-chain success. It should never be described as a platform-owned withdrawal sender.

Chain transaction failure is not a business terminal state by itself. If a user
broadcasts a valid ticket with too little gas and the transaction reverts before
`deadline`, Gateway must keep the withdrawal active and the ticket unconsumed;
the user can retry the same ticket with normal gas before the deadline. Gateway
only releases funds when the local expiry buffer, RPC block timestamp margin,
and `isTicketConsumed(ticketHash)=false` all agree that the ticket is physically
dead.

This is why an expired approved withdrawal may not release the instant the
frontend first shows “about to expire.” The system intentionally waits for all
three conditions below before releasing pending funds:

1. local wall-clock time is past `deadline + WITHDRAW_TICKET_EXPIRY_BUFFER_SEC`
2. latest RPC block timestamp is past `deadline + WITHDRAW_RPC_FINALITY_MARGIN_SEC`
3. `isTicketConsumed(ticketHash)` is still `false`

Only then does Gateway fail closed into `FAILED_EXPIRED` and release the locked
pending balance back to withdrawable balance.

Release evidence for this model is generated with:

```bash
npm run e2e:withdrawal-one-ticket-evidence
npm run ci:withdrawal-one-ticket-evidence
```

The evidence bundle must include the consumer replay attack scenario and the
provider low-gas revert retry scenario. These are the two negative cases that
prove a failed chain receipt does not incorrectly roll the off-chain state back.

## Storage

| Table                         | Role                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `synapse_account_balances`    | Source of truth for `available_balance`, `pending_balance`, and `frozen_balance`     |
| `synapse_vault_withdrawals`   | Persistent withdrawal rows with `withdrawal_kind='consumer_refund'`                  |
| `synapse_runtime_state`       | Runtime metadata including risk and review context                                   |
| `vault_withdrawal_meta::{id}` | Ticket metadata mirror used to recover ticketId, ticketHash, deadline, and signature |
| `synapse_audit_events`        | Audit trail for create, fail, approve, reject, cancel, and complete actions          |

## Core Guarantees

- consumer withdrawals never spend provider funds
- balance reservation happens before the row is exposed to the client
- ticket signing happens only after successful balance reservation
- repeated requests do not double-deduct the treasury
- terminal failures release reserved balance
- Payments shows one stable withdrawal record instead of duplicate refund rows
