---
description: "Use when writing or modifying finance backend, balance, billing, settlement, ledger, deposit, withdraw, refund, reconciliation, idempotency, audit, or transaction-sensitive Python code. Covers money safety, Decimal usage, idempotency, audit trails, and ACID transaction rules."
applyTo:
  - "gateway/**/*.py"
  - "services/gateway-admin/**/*.py"
  - "provider_service/**/*.py"
name: "Synapse Finance Backend Rules"
---

# Synapse Finance Backend Rules

## Scope

- This file applies to finance-sensitive backend work.
- It is narrower than the general Python instruction and should be treated as the higher bar when money, balances, or settlement state are involved.

## Non-Negotiable Rules

- Use `Decimal` for all money and settlement arithmetic. Never use `float`.
- Favor consistency, auditability, and rollback safety over convenience or micro-optimizations.
- Treat every balance mutation as transaction-sensitive and auditable.

## Idempotency and Replay Protection

- Every deposit, deduction, refund, withdraw, or settlement-like operation needs a stable idempotency key.
- Prefer durable uniqueness at the database layer, not just in-memory or request-layer checks.
- Replayed requests must return stable business semantics instead of duplicating state changes.

## Transactions and Concurrency

- Multi-step money mutations must commit inside one transaction.
- If any sub-step fails, rollback the entire unit of work.
- Do not use read-modify-write balance logic without locking or atomic update guarantees.
- Prefer row-level locking or atomic conditional updates for balance changes.
- Concurrency correctness beats throughput shortcuts on financial paths.

## Audit and Traceability

- Every money-affecting operation must leave an append-only audit trail.
- Audit records should preserve actor, owner, request identity, before and after values, delta, result status, and timestamp.
- Error handling should preserve enough context for reconciliation without leaking internals externally.

## Validation

- Amounts must be positive when the operation semantics require positive input.
- Validate currency, owner identifiers, request IDs, transaction hashes, and status enums explicitly.
- Reject malformed or partial finance input instead of guessing intent.

## Testing Expectations

- Cover happy path and failure path together.
- Add tests for replay, duplicate requests, insufficient balance, rollback, and concurrency-sensitive behavior where applicable.
- If reconciliation or settlement semantics change, update docs and tests in the same change.

## Finance Security Reviewer Checklist

When reviewing any finance-sensitive code change, run through each severity tier before approving or completing the task.

### 🔴 CRITICAL — Must fix before merge

- [ ] No `float` anywhere in money arithmetic, fee calculation, or balance comparison
- [ ] Every balance mutation is inside an explicit DB transaction with rollback on failure
- [ ] Concurrency: balance reads that precede writes use row-level locks or atomic conditional updates
- [ ] Idempotency key present on all deposit, deduction, refund, withdraw, and retry paths
- [ ] No SQL injection surface: queries use parameterized statements or ORM-bound values only
- [ ] Auth/role check present before any balance-changing or approval-triggering route
- [ ] No secret, private key, or internal stack trace leaks in any error response

### 🟡 WARNING — Should fix in same change

- [ ] Audit trail records `actor`, `owner`, `request_id`, `before_amount`, `after_amount`, `delta`, `status`, `timestamp`
- [ ] Rejected or failed operations write a failure audit record (not just a log line)
- [ ] External payment or chain call has explicit timeout and defensive error handling
- [ ] All finance amounts validated as positive where semantics require it
- [ ] Currency, owner IDs, and status enums explicitly validated at the API boundary

### 🔵 INFO — Flag for awareness

- [ ] Reconciliation-sensitive fields are stable (no renamed columns without a migration + docs update)
- [ ] Settlement or deduction semantics changes are reflected in tests and docs in the same PR
- [ ] New finance endpoints have integration tests covering replay and insufficient-balance paths

## ⚠️ Gotchas — Known Finance Failure Patterns

These are historical failure modes in this codebase. When reviewing financial code, check each one before completing the task:

**Decimal / Float traps**
- Using `float` anywhere in a fee calculation, balance delta, or settlement amount — even temporarily for display or rounding.
- Calling `round()` on a `Decimal` and immediately passing the result back into arithmetic. Use `quantize()` with explicit rounding mode.

**TOCTOU (Time-of-Check / Time-of-Use) on balances**
- Reading balance → checking sufficiency → deducting in separate queries without row-level lock.
- Correct pattern: `SELECT ... FOR UPDATE` or atomic `UPDATE balance SET amount = amount - ? WHERE amount >= ? AND id = ?` with rowcount check.

**Idempotency key coverage gaps**
- Adding a new money-affecting endpoint without wiring an idempotency key from day one.
- Accepting the same `idempotency_key` across different operations (key must include operation type prefix).

**Silent rollback loss**
- Catching an exception inside a transaction, logging it, then allowing the function to return success while the DB already rolled back.
- If you catch inside a transaction, re-raise or explicitly abort and surface the failure.

**Partial operation returning HTTP 200**
- Returning 200 when only some records in a batch were written due to a mid-loop exception.
- Finance paths are all-or-nothing unless the contract explicitly documents partial-success semantics.

**Audit trail collapse**
- Writing only the final result to the audit log and omitting the `before_amount`, `delta`, and `request_id`.
- A ledger entry without `actor`, `owner`, `request_id`, `before`, `after`, `delta`, and `status` is not a ledger entry.