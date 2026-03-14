---
name: Production Upgrade Checklist
about: Track storage and financial-safety hardening tasks before production launch
title: "[Prod Upgrade] "
labels: ["production", "storage", "security"]
assignees: []
---

## Scope

- Owner:
- Reviewer:
- Target release date:
- Current phase: P0 / P1 / P2

## P0 - Must Complete Before Launch

### 1) Database and connectivity
- [ ] Use managed PostgreSQL instance (not local container)
- [ ] Enable TLS and least-privilege DB accounts
- [ ] Set connection pool limits, timeout, and retry policy

### 2) Financial transaction safety
- [ ] Keep debit/credit/ledger write in one transaction
- [ ] Use `SELECT ... FOR UPDATE` for balance row locking
- [ ] Reject negative amount and invalid precision input
- [ ] Add unique idempotency key (`request_id`) for each financial action
- [ ] Add tests for rollback path on failure

### 3) Idempotency and replay protection
- [ ] Require idempotency key at API layer
- [ ] Add unique index to prevent duplicate ledger writes
- [ ] Replay request returns prior result, no second deduction

### 4) Audit and safe error surface
- [ ] Record full audit fields (`request_id`, `owner`, `actor`, `amount_delta`, `balance_before`, `balance_after`, `result`, `ts`)
- [ ] Ensure logs never print token/secret/private material
- [ ] Return sanitized external errors without internal stack leakage

### 5) Backup and disaster recovery
- [ ] Enable daily full backup + WAL incremental backup
- [ ] Define and document RPO/RTO target
- [ ] Run at least one full restore drill and keep report

## P1 - Recommended Before Launch

### 6) Log partitioning and retention
- [ ] Partition `gateway_logs` by month (or day for higher traffic)
- [ ] Automate partition creation ahead of rollover
- [ ] Define retention/archive policy (for example 90-day hot data)

### 7) Monitoring and alerting
- [ ] Monitor slow query, lock wait, deadlock, pool exhaustion
- [ ] Add alert channel and on-call SOP
- [ ] Add financial anomaly alerts (negative-balance attempts, duplicate `request_id` spikes)

### 8) Load test and regression
- [ ] Run concurrency load test for financial path
- [ ] Verify no overdraft, no duplicate charge, no balance drift
- [ ] Run regression suite and attach result summary

## P2 - Scale Stage

### 9) Redis light integration
- [ ] Add Redis lock for request burst replay prevention
- [ ] Add hot-balance pre-deduction with atomic operation

### 10) Log offload pipeline
- [ ] Introduce queue (Kafka or RabbitMQ)
- [ ] Offload gateway logs to ClickHouse asynchronously
- [ ] Build 30-day trend, failure-rate, P95/P99 dashboards

## Go / No-Go

- [ ] All P0 items complete
- [ ] At least 80% P1 complete
- [ ] No blocking issues in latest load test and regression
- [ ] Docs, code, and tests are consistent in the same iteration

## Links

- Storage strategy: [doc/02_Architecture/Storage_Strategy_Upgrade.md](../../doc/02_Architecture/Storage_Strategy_Upgrade.md)
- Production TODO source: [doc/02_Architecture/Production_Upgrade_TODO.md](../../doc/02_Architecture/Production_Upgrade_TODO.md)
