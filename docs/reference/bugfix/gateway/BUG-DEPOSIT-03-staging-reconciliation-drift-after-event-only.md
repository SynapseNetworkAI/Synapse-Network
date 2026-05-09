# BUG-DEPOSIT-03 — Staging Reconciliation Drift After Event-Only Deposit Indexer

**Status:** Fixed
**Severity:** High  
**Component:** `services/gateway` — deposit indexer / reconciliation  
**Reported:** 2026-05-09  
**Environment:** `staging`  
**Last verified against runtime:** 2026-05-09

---

## Summary

After the staging `deposit-indexer` was switched onto the event-only path and
the Cloud Scheduler cadence was reduced to `*/10 * * * *`, the job started
logging a persistent reconciliation mismatch:

```text
alert_trigger=RECONCILIATION_DRIFT env=staging
delta_usdc=19.507328
chain_vault_usdc=1258.500000
ledger_obligation_usdc=1238.992672
threshold_usdc=1.000000
```

This drift was observed on repeated successful Cloud Run Job executions even
while the new event-only path was active.

The investigation found **two separate causes**:

1. The reconciliation aggregation only counted consumer available + pending
   balances and omitted:
   - consumer frozen balance
   - provider wallet balances
   - platform revenue
2. Historical completed consumer withdrawals had already retained the flat
   signed fee on-chain, but the internal ledger had never credited those fees
   into `platform_revenue`.

## Runtime Evidence

Live Cloud Logging samples captured on 2026-05-09:

```text
2026-05-09T14:02:53Z deposit backfill done mode=event start_block=265498487 end_block=265498686 scanned=200 items=0 recovered=0
2026-05-09T14:02:54Z alert_trigger=RECONCILIATION_DRIFT env=staging delta_usdc=19.507328 chain_vault_usdc=1258.500000 ledger_obligation_usdc=1238.992672 threshold_usdc=1.000000
```

The same drift signature was also present on prior executions at:

- `2026-05-09T13:42:16Z`
- `2026-05-09T13:51:58Z`
- `2026-05-09T14:02:54Z`

## Root Cause

### 1. Reconciliation formula bug

`deposit-indexer` originally compared chain vault balance against
`ledger.total_consumer_obligation()`. That view only represented consumer
available + pending balances, so it systematically under-counted vault-tracked
value whenever staging contained:

- manual-review frozen consumer withdrawals
- provider receivables
- accrued platform revenue

This is why the drift later expanded from `19.507328` to `520.007328` once
staging accumulated more provider and frozen state.

### 2. Historical consumer withdrawal fee accounting gap

After the formula bug was fixed, the repeated live drift dropped to exactly:

```text
delta_usdc=4.000000
chain_vault_usdc=2549.000000
ledger_obligation_usdc=2545.000000
```

Staging DB + chain inspection showed:

- `consumer_refund` rows with `status='COMPLETED'`: `8`
- flat consumer withdrawal fee: `0.500000 USDC`
- total missing internal fee accrual: `8 * 0.500000 = 4.000000 USDC`

So the remaining delta was not a missing deposit event. It was historical fee
principal still retained inside `SynapseCore.platformFeePool` but never
credited into `platform_revenue::main`.

## Fix

### Code fix

1. Reconciliation now uses the full vault-tracked ledger view:
   - consumer available + pending + frozen
   - provider available + pending + frozen
   - platform fee accrued
2. Consumer withdrawal completion now accrues the flat fee into
   `platform_revenue` on both:
   - the event watcher completion path
   - the atomic `complete_withdraw_tx_atomic(...)` path
   - the non-atomic local fallback path

### Staging data repair

A one-time staging-only backfill credited the missing historical fees into
`platform_revenue::main` and wrote an idempotent repair marker:

```text
state_key = repair::consumer_withdraw_fee_backfill_20260509
amountUsdc = 4.000000
completedConsumerWithdrawCount = 8
flatFeeUsdc = 0.500000
```

This repair is intentionally narrow and only applies to the staging residue
created before the code fix existed.

## Verification

### Before final fee backfill

Live Cloud Run execution `synapse-staging-deposit-indexer-9zzmw` logged:

```text
deposit reconciliation checked chain_vault=2549.000000 ledger_obligation=2545.000000 delta=4.000000 alert=True
```

### After final fee backfill

Live Cloud Run execution `synapse-staging-deposit-indexer-4m9cb` logged:

```text
deposit reconciliation checked chain_vault=2549.000000 ledger_obligation=2549.000000 delta=0.000000 alert=False
```

The persisted runtime snapshot also confirms closure:

```json
{
  "alert": false,
  "deltaUsdc": "0.000000",
  "chainVaultUsdc": "2549.000000",
  "ledgerObligationUsdc": "2549.000000"
}
```

## Why This Matters

The new deployment goals are still valid:

- scheduler cadence is truly `10` minutes
- the indexer is truly using `mode=event`
- RPC cost should fall materially

This bug mattered because an event-only rollout can look operationally healthy
while finance truth is still wrong. The final closure criteria was not “job
succeeded”; it was “repeated live reconciliation no longer emits
`RECONCILIATION_DRIFT`”.
