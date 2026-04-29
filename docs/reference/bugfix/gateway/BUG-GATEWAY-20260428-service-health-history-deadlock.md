# BUG-GATEWAY-20260428: Service health history runtime_state deadlock

## Status

Fixed locally.

## Impact

Cloud SQL reported repeated PostgreSQL `deadlock detected` errors on staging for `synapse_gateway_staging`.

The deadlock was not in ledger or withdrawal settlement. The blocked statements were service health history maintenance writes:

```sql
DELETE FROM synapse_runtime_state WHERE state_key LIKE 'service_health_history::%%'
```

and concurrent `INSERT ... ON CONFLICT ... DO UPDATE` writes to the same `synapse_runtime_state` keys.

## Root Cause

Multiple Cloud Run instances/jobs can append or prune service health history at the same time. The previous implementation rewrote all service health history by deleting every `service_health_history::*` runtime row and then re-inserting grouped rows. Concurrent full-prefix deletes and upserts created row/index lock cycles inside `synapse_runtime_state`.

## Fix

- Serialize service health history rewrites with a PostgreSQL transaction-scoped advisory lock:
  `pg_advisory_xact_lock(hashtext('synapse_runtime_state:service_health_history'))`.
- Replace the unconditional full-prefix delete with a scoped obsolete-key delete:
  `DELETE ... WHERE state_key LIKE ... AND state_key NOT IN (...)`.
- Upsert history keys in sorted service-id order for deterministic write order.

## Validation

- Unit coverage verifies the advisory lock is acquired before mutation.
- Unit coverage verifies the delete only removes obsolete history keys and does not clear the entire prefix during normal writes.

## Follow-Up

If this path becomes high-volume, move health history from JSON payload rows in `synapse_runtime_state` into a dedicated append-only table with time-based pruning. The current fix is the minimal safe MVP patch for Cloud Run concurrency.
