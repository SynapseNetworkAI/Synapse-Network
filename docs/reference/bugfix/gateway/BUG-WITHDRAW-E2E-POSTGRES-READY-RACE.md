# BUG-WITHDRAW-E2E-POSTGRES-READY-RACE

## Symptom

Running `npm run e2e:withdrawal-one-ticket-evidence` after the withdrawal risk
policy change failed before any business assertion:

```text
psql: error: connection to server at "127.0.0.1", port 15432 failed: Connection refused
```

## Root Cause

`scripts/local/setup_local_env.sh` waited for Postgres readiness on hard-coded
port `5432`. The withdrawal evidence runner may intentionally choose an
alternate host port such as `15432` when local `5432` is unavailable. The setup
script therefore observed the wrong port and continued to bootstrap before the
actual E2E database was ready.

## Fix

`setup_local_env.sh` now resolves the readiness port from `PGPORT` or
`SYNAPSE_POSTGRES_HOST_PORT`, falling back to `5432`.

The withdrawal one-ticket runner also pins withdrawal policy env vars and seed
amounts for its contract-focused rehearsal: minimum-compatible withdrawal
amounts, zero maturity windows, enough consumer principal for all consumer
scenarios, and enough provider receivable for all provider scenarios. The
dedicated risk-policy E2E covers Dust and T+N behavior separately.

## Verification

Re-run:

```bash
npm run e2e:withdrawal-one-ticket-evidence
```
