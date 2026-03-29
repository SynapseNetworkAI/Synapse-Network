---
description: "Use when the task involves production deployments, database migrations, DROP/TRUNCATE/DELETE without WHERE, force-push, kubectl delete, contract deployment, USDC settlement execution, or any operation that is irreversible or affects shared infrastructure. This is the on-demand safety gate — only activate when the task context explicitly touches destructive or production-critical operations."
applyTo:
  - "scripts/**"
  - "docker-compose/**"
  - "contracts/**"
  - "**/*migration*"
  - "**/*deploy*"
name: "Synapse Production Safety Guard"
---

# Synapse Production Safety Guard

## Purpose

This instruction activates as an on-demand safety gate for destructive, irreversible, or production-critical operations.
It is intentionally NOT loaded for normal development tasks — only when the task context touches the paths above.

## Pre-Flight Checklist

Before executing any operation covered by this file, verify **every item** in this checklist.
Do not proceed until all applicable items are confirmed.

### Irreversibility check
- [ ] Can this operation be rolled back if it goes wrong?
- [ ] If NO: has the user explicitly acknowledged the irreversibility and confirmed they want to proceed?
- [ ] Is there a tested rollback script or migration-down path ready?

### Scope check
- [ ] Does this operation affect production, staging, or a shared database?
- [ ] Are the target environment variables confirmed (not accidentally pointing at prod from a local `.env`)?
- [ ] Is the scope limited to the minimum necessary tables, rows, or resources?

### Data-loss blast radius
- [ ] Does the script or command contain `DROP`, `TRUNCATE`, `DELETE` without a `WHERE` clause, or `rm -rf`?
- [ ] If YES: stop and require explicit user confirmation with the exact target named.
- [ ] Is there a recent backup or snapshot for the affected data?

### Finance / settlement operations
- [ ] Does this touch live USDC balances, on-chain contract state, or settlement execution records?
- [ ] If YES: confirm the idempotency key and that a dry-run or simulation has been reviewed first.
- [ ] Contract deployments must be reviewed against the audited ABI before execution.

### Git / branch safety
- [ ] No `--force` push to `main` or any shared branch without explicit user authorization.
- [ ] No `git reset --hard` on a branch with unreviewed or unmerged changes.
- [ ] Migration commits must be on a feature branch and PR-reviewed before merging to `main`.

## Blocked Patterns

The following operations require an explicit stop and user confirmation — never execute silently:

| Operation | Reason |
|-----------|--------|
| `DROP TABLE` / `TRUNCATE` | Irreversible data loss |
| `DELETE FROM <table>` without `WHERE` | Full table wipe |
| `git push --force` to `main` | Rewrites shared history |
| `kubectl delete` on production namespace | Irreversible infra teardown |
| Hardhat deploy to mainnet without dry-run | On-chain state is permanent |
| `.env` with `DATABASE_URL` pointing to prod used in a migration script | Wrong-env data mutation |

## Safe Execution Pattern

When a destructive task is necessary and confirmed:

1. **State the exact operation** — name the table, file, branch, or contract address
2. **State the impact** — what will be permanently changed or deleted
3. **Confirm rollback path** — what is the recovery procedure
4. **Execute narrowly** — run only the confirmed operation; do not chain additional mutations
5. **Leave an audit note** — commit message or doc update describing what was done and why

## ⚠️ Gotchas — Known Production Safety Failures

**Wrong env file loaded**
- Running a migration script locally that reads `.env` instead of `.env.local`, silently targeting the production database because `DATABASE_URL` in `.env` was never overridden locally.

**Contract deployment without simulation**
- Deploying an updated `SynapseCore.sol` to mainnet without first running `hardhat test` against a fork — on-chain state diverges from expected behavior with no rollback.

**Settlement exec in test suite**
- A test that hits a real USDC transfer path because `MOCK_SETTLEMENT=false` was committed to a shared `.env` file. Settlement tests must use mock providers unless explicitly marked as integration tests with a production key guard.

**Migration without down path**
- A migration that adds a `NOT NULL` column without a default and no `down` migration — breaks rollback and makes hotfix deploys impossible under pressure.

**Batch delete scope creep**
- A cleanup script written as `DELETE FROM ledger_entries WHERE status = 'test'` that runs fine in dev but in prod matches 50,000 live records because the `status` labeling convention differed.
