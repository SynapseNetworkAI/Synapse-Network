---
description: "Use when writing or modifying finance backend, balance, billing, settlement, ledger, deposit, withdraw, refund, reconciliation, idempotency, audit, or transaction-sensitive Python code. Covers money safety, Decimal usage, idempotency, audit trails, and ACID transaction rules."
applyTo:
  - "gateway/**/*.py"
  - "admin/gateway-admin/**/*.py"
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