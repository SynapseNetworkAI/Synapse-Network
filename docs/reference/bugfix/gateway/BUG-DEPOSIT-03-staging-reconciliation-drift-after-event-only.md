# BUG-DEPOSIT-03 — Staging Reconciliation Drift After Event-Only Deposit Indexer

**Status:** Open  
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

## Why This Matters

The new deployment goals are still valid:

- scheduler cadence is truly `10` minutes
- the indexer is truly using `mode=event`
- RPC cost should fall materially

But the money-path is not fully clean while reconciliation drift remains above
threshold. A successful event-only rollout does **not** mean vault-vs-ledger
truth is already aligned.

## Suspected Investigation Areas

1. Historical ledger obligations not released or not matched to current vault.
2. A stale deposit / withdrawal / refund row contributing to obligation totals.
3. Event-only confirm path and reconciliation snapshot using different inclusion
   rules for pending/terminal rows.
4. Staging-only historical residue from earlier dogfood runs that needs a
   controlled one-time cleanup or replay.

## Recommended Next Step

Run a focused staging reconciliation investigation before treating staging as
financially clean:

1. Pull the exact DB reconciliation snapshot from the latest staging core
   dogfood evidence and the deposit indexer runtime tables.
2. Compare `synapse_account_balances`, withdrawal/refund terminal rows, and
   pending deposit intents against vault chain balance.
3. Identify whether the `19.507328 USDC` delta is:
   - one stale business row
   - an aggregation bug
   - or a historical seed residue

Do not close this bug until the repeated Cloud Run Job logs stop emitting
`RECONCILIATION_DRIFT` on staging.
