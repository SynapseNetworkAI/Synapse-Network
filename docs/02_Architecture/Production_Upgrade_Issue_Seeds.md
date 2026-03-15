# Production Upgrade Issue Seeds（可直接复制到 GitHub）

本文件用于把 P0/P1 任务快速拆成可指派 issue。
建议流程：
- 先创建一张总看板 issue（使用 `production-upgrade-checklist` 模板）
- 再按下列子任务创建 issue（使用 `production-upgrade-work-item` 模板）

---

## Seed 1

- Title: [Prod Task] Migrate runtime storage to managed PostgreSQL with TLS and least privilege
- Suggested Labels: production, storage, security, p0
- Description:
  - Replace local/dev database wiring with managed PostgreSQL for production environment.
  - Enforce TLS connection and separate least-privilege DB roles.
  - Define connection pool size, timeout, retry policy in config.
- Acceptance Criteria:
  - Production config points to managed PostgreSQL only.
  - TLS verified in connection settings.
  - Separate DB roles documented and applied.
  - Connection pool metrics visible in runtime logs/monitoring.
- Dependencies: none

## Seed 2

- Title: [Prod Task] Enforce atomic transaction for debit-credit-ledger write path
- Suggested Labels: production, billing, transaction, p0
- Description:
  - Ensure buyer debit, seller credit, and ledger entry execute in one DB transaction.
  - Any failure in sub-step must rollback full transaction.
- Acceptance Criteria:
  - Single transaction boundary implemented and code-reviewed.
  - Failure simulation proves full rollback.
  - Unit tests cover success + rollback branch.
- Dependencies: Seed 1

## Seed 3

- Title: [Prod Task] Add row-level lock (SELECT FOR UPDATE) for balance mutation
- Suggested Labels: production, concurrency, billing, p0
- Description:
  - Apply pessimistic locking on balance rows during debit/credit path.
  - Prevent race-condition overcharge under concurrent requests.
- Acceptance Criteria:
  - Critical balance read path uses `SELECT ... FOR UPDATE`.
  - Concurrency test shows no overdraft and no lost update.
  - Lock wait behavior documented.
- Dependencies: Seed 2

## Seed 4

- Title: [Prod Task] Implement strict idempotency key and unique index for financial actions
- Suggested Labels: production, idempotency, security, p0
- Description:
  - Require `request_id` for financial mutation APIs.
  - Add DB unique constraint/index to prevent duplicate ledger writes.
  - Replay request returns prior result, not second deduction.
- Acceptance Criteria:
  - API rejects missing idempotency key.
  - Duplicate request_id does not create new financial mutation.
  - Unit tests cover first-call and replay-call behavior.
- Dependencies: Seed 2

## Seed 5

- Title: [Prod Task] Harden audit trail fields for all money movement events
- Suggested Labels: production, audit, compliance, p0
- Description:
  - Ensure every financial event records request_id, owner, actor, amount delta, before/after balance, timestamp, result.
  - Normalize schema and serialization for downstream investigation.
- Acceptance Criteria:
  - Audit field schema finalized and enforced.
  - All financial paths emit complete audit fields.
  - Spot-check script verifies no missing critical fields.
- Dependencies: Seed 2

## Seed 6

- Title: [Prod Task] Sanitize error surface and block secret leakage in logs
- Suggested Labels: production, security, observability, p0
- Description:
  - Remove token/secret/private material from logs.
  - Ensure external API errors are sanitized and do not leak internal stack/schema details.
- Acceptance Criteria:
  - Log redaction applied to auth and billing paths.
  - Security review confirms no secret exposure in sampled logs.
  - Regression tests cover representative error responses.
- Dependencies: none

## Seed 7

- Title: [Prod Task] Establish backup policy (full + WAL) and run restore drill
- Suggested Labels: production, backup, dr, p0
- Description:
  - Configure automated full backups and WAL incremental backups.
  - Define RPO/RTO target and validate with a full restore drill.
- Acceptance Criteria:
  - Backup schedule documented and active.
  - Restore drill report attached with elapsed time and data verification.
  - RPO/RTO recorded in docs.
- Dependencies: Seed 1

## Seed 8

- Title: [Prod Task] Partition gateway_logs and automate monthly partition creation
- Suggested Labels: production, logging, performance, p1
- Description:
  - Implement time-based partitions for `gateway_logs` (monthly by default).
  - Add automation to pre-create next partition before month rollover.
- Acceptance Criteria:
  - Partitioned table active in production schema.
  - Partition creation job runs automatically.
  - Query path validated for latest + historical partition.
- Dependencies: Seed 1

## Seed 9

- Title: [Prod Task] Add DB/financial anomaly monitoring and on-call alerts
- Suggested Labels: production, monitoring, p1
- Description:
  - Monitor slow query, lock wait, deadlock, pool exhaustion.
  - Add anomaly alerts for negative-balance attempts and duplicate request_id spikes.
  - Define on-call response SOP.
- Acceptance Criteria:
  - Dashboards and alerts configured.
  - Alert routing tested.
  - Runbook/SOP documented in repo.
- Dependencies: Seed 1

## Seed 10

- Title: [Prod Task] Execute financial-path concurrency load test and publish gate report
- Suggested Labels: production, testing, p1
- Description:
  - Run concurrency load test for debit/credit/ledger flow.
  - Validate no overdraft, no duplicate charge, no balance drift.
  - Produce go/no-go report for release gate.
- Acceptance Criteria:
  - Load test scenario and command are documented.
  - Result report attached with pass/fail metrics.
  - Any blocker issue converted into tracked tasks.
- Dependencies: Seed 2, Seed 3, Seed 4

---

## Recommended Create Order

1. Create one board issue from template:
   - `.github/ISSUE_TEMPLATE/production-upgrade-checklist.md`
2. Create Seed 1-7 as P0 sprint.
3. Create Seed 8-10 as P1 parallel stream.
4. Link every child issue back to the board issue.

## Suggested Milestone

- Milestone Name: Production Baseline - Financial Safety
- Gate: P0 complete + no blocker in load/regression + docs/code/tests consistent
