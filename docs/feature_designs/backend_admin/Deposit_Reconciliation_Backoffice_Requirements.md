# Deposit Reconciliation Backoffice Requirements (V1)

## 1. Background

Current V2 deposit pipeline is intent-driven: chain credits are only applied when `deposit_intent` exists.
When frontend intent submission fails after onchain success, chain vault and offchain ledger can diverge.

This document defines backoffice-level controls to recover and prevent divergence.

## 2. Goals

1. Recover missed deposits automatically by block scanning.
2. Detect chain-vs-ledger drift continuously and alert quickly.
3. Provide deterministic operator tooling to replay a tx hash without manual DB edits.
4. Keep buyer UX resilient when intent submission fails transiently.

## 3. Scope

### 3.1 Backend runtime capabilities

1. **Backfill scanner task**
   - Scan confirmed blocks for router deposit-related events.
   - For events without existing intents, auto-create recovery intent.
   - Reuse existing confirmation path to ensure atomic ledger application.

2. **Strong consistency reconciliation metric**
   - Compare `vault_token_balance(router)` vs `sum(buyers.available + buyers.pending)`.
   - Emit alert when absolute delta exceeds threshold.
   - Persist latest check summary in indexer status payload.

3. **Admin replay API**
   - Endpoint: `POST /api/v1/admin/deposits/replay`.
   - Input: `txHash`.
   - Behavior: decode chain receipt events, create missing intent if needed, replay confirmation.
   - Auth: admin wallets only (`PLATFORM_FEE_ADMIN_WALLETS`).

### 3.2 Frontend buyer-console resilience

1. Onchain tx success + intent submit failure must enqueue retry task in browser storage.
2. Retry task runs periodically while session is active until intent submit succeeds.
3. Queue survives page refresh and retries with bounded backoff.
4. Success clears queue item and refreshes balances.

## 4. Non-functional Requirements

1. **Idempotent recovery**
   - Event replay must not double-credit existing processed events.
2. **Operational visibility**
   - Indexer status should expose backfill and reconciliation snapshots.
3. **No manual SQL for daily operations**
   - Replay API must cover production hotfix scenarios.
4. **Auditability**
   - All admin replay and reconciliation alerts must append audit entries.

## 5. Data and State Contract

1. `deposit_backfill_state` (collection)
   - `lastScannedBlock`
   - `lastScanAt`
   - `updatedAt`

2. `deposit_reconciliation_state` (collection)
   - `lastAlertAt`
   - `updatedAt`

3. Indexer status extension
   - `backfill`: enabled/last scanned block/recovered/error
   - `reconciliation`: chain vault balance/ledger obligation/delta/alert/error

## 6. API Contract (Backoffice)

### 6.1 Replay deposit by tx hash

- Method: `POST`
- Path: `/api/v1/admin/deposits/replay`
- Body:

```json
{
  "txHash": "0x..."
}
```

- Success response:

```json
{
  "status": "success",
  "requestedBy": "0xadmin...",
  "replay": {
    "txHash": "0x...",
    "events": 1,
    "intentsCreated": 1,
    "credited": 1,
    "failed": 0,
    "pending": 0
  }
}
```

- Error codes:
  - `INVALID_TX_HASH`
  - `TX_NOT_CONFIRMED`
  - `TX_FAILED`
  - `MISSING_TX_RECEIPT`
  - `NO_MATCHING_DEPOSIT_EVENT`

## 7. Operations Playbook

1. Buyer reports onchain success but no gateway balance increase.
2. Operator checks `GET /api/v1/indexer/status`:
   - backfill cursor progress
   - reconciliation delta
3. Operator triggers replay endpoint with tx hash.
4. Verify replay summary and subsequent balance/audit changes.
5. If delta remains above threshold, open incident and inspect token/router config.

## 8. Rollout Plan

1. Enable in development with default safe thresholds.
2. Validate replay on historical tx hashes.
3. Enable in staging and verify no duplicate credits under repeated replay.
4. Gradually enable in production with audit monitoring.

## 9. Future Enhancements

1. Multi-token vault reconciliation panel.
2. Backoffice UI workflow for bulk replay from CSV.
3. Drift trend chart and incident auto-ticket integration.
