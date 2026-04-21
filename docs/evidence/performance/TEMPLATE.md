---
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
doc_status: draft
---

# Performance and Reliability Evidence - RUN_NAME

## Run Metadata

- Environment:
- Commit:
- Run time:
- Runner:
- Rehearsal run id:
- Config manifest:
- Test data manifest:
- Evidence directory:

## Scope

- [ ] Discovery/quote/invoke load test
- [ ] Balance/deposit/withdrawal load test
- [ ] Provider health probe load test
- [ ] Admin analytics and finance view load test
- [ ] High-concurrency money test
- [ ] Provider outage chaos drill
- [ ] Gateway restart chaos drill
- [ ] Gateway-admin restart chaos drill
- [ ] ClickHouse/Kafka outage drill
- [ ] RPC outage or slow RPC drill
- [ ] Postgres failover drill
- [ ] Redis unavailable drill
- [ ] Application rollback drill
- [ ] Config rollback drill
- [ ] Signer rollback procedure

## Traffic Model

| Flow | Duration | Concurrency | Ramp | Notes |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Wallet / Signer Isolation

- Consumer wallet count:
- Provider wallet count:
- Faucet funding strategy:
- Per-wallet chain write serialization:
- Chain nonce collisions:
- Secret redaction check:

## Results

| Area | Success Rate | p50 | p95 | p99 | Error Distribution | PASS/FAIL |
| --- | --- | --- | --- | --- | --- | --- |
| Discovery |  |  |  |  |  |  |
| Invoke |  |  |  |  |  |  |
| Balance |  |  |  |  |  |  |
| Finance mutation |  |  |  |  |  |  |
| Admin analytics |  |  |  |  |  |  |
| Provider health |  |  |  |  |  |  |

## Reliability Signals

- DB pool:
- DB lock wait:
- Deadlocks:
- Queue lag:
- ClickHouse lag:
- Kafka lag:
- RPC latency:
- Provider health scheduled/checked/skipped:

## Reconciliation

- Ledger before:
- Ledger after:
- Vault before:
- Vault after:
- Unexplained delta:
- Drain hard cap exceeded:
- Abandoned in-flight requests:

## Chaos / Recovery Evidence

- Fault injected:
- Alert fired:
- Dashboard screenshot/link:
- Logs:
- Recovery action:
- Recovery time:
- Post-drill reconciliation:

## Bugs

| Bugfix | Status | Verification |
| --- | --- | --- |
|  |  |  |

## Decision

- Result: PASS / FAIL / NO-GO
- Validation updates allowed:
- Residual risk:
