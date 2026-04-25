# Finance Approval Safety Invariants

- Status: canonical
- Code paths: `services/gateway/src/**`, `services/gateway-admin/src/**`, `services/admin-front/src/**withdrawal-reviews**`, `scripts/e2e/admin_withdrawal_approval_*.mjs`, `scripts/ui/dogfood_admin_withdrawal_approval.mjs`
- Verified with: `npm run ci:finance-approval-safety`, `npm run ci:finance-approval-e2e-evidence`, `npm run e2e:admin-withdrawal-approval`
- Last verified against code: 2026-04-20

This document converts the Provider withdrawal approval E2E defects into hard engineering invariants. It applies to deposit, withdrawal, refund, approval, review, complete, ledger, audit, reconciliation, and admin control-plane paths.

Production rule: if any invariant below fails, the change is not releasable.

## Core Invariants

### FIN-MONEY-001: Money Is Never Float

Money computes as `Decimal`, crosses HTTP/JSON boundaries as string, and reaches contracts as atomic integer. `float`, `Optional[float]`, `Union[..., float]`, `round(...)` money logic, and JSON money numbers are forbidden in finance-sensitive paths.

Why: float drift can create audit mismatches, incorrect ticket amounts, provider payout errors, and reconciliation tail dust.

Agent repair instruction: replace the value/type with `decimal.Decimal`, quantize through the money helper, serialize output as string, and add a Decimal regression assertion.

### FIN-BUCKET-003: Bucket Moves Are Atomic

Withdrawal buckets must move only through approved atomic operations:

1. `available -> frozen` when the withdrawal intent is accepted.
2. `frozen -> pending` when admin approval issues a signed ticket.
3. `pending -> completed` when the chain claim is completed and Gateway records the tx hash.
4. `frozen -> available` when review rejects or expires safely.

Routers, projections, UI presenters, and ad hoc scripts must not directly mutate `available_balance`, `pending_balance`, or `frozen_balance`.
Consumer manual withdrawal reject is release-blocking here: rejecting a
`consumer_refund` review must atomically set the withdrawal status to
`REJECTED`, move the exact amount from `consumer_frozen_balance` back to
`consumer_available_balance`, leave `pending_balance` unchanged, and write both
admin and financial audit evidence. If the frozen bucket is insufficient, the
review request must fail closed and the status must remain
`PENDING_MANUAL_REVIEW`.

Why: direct writes caused a real `WITHDRAWAL_LOCK_INCONSISTENT` defect where the provider claimed on-chain funds but Gateway could not reconcile the pending bucket.

Agent repair instruction: move the logic into an atomic repository/service method, lock or conditionally update the row, assert rowcount, and add expected-vs-actual bucket tests.

### FIN-IDEMPOTENCY-006: Every Money Write Is Idempotent

Deposit, withdrawal, refund, review decision, complete, retry, and execution paths require a stable idempotency key or an equivalent unique database constraint.

Required behavior:

1. Same operation and same idempotency key returns the same result.
2. Same active withdrawal cannot freeze the same funds twice.
3. Duplicate `complete` cannot apply the same tx hash twice.
4. Duplicate approval cannot generate a second ticket.

Agent repair instruction: add operation-scoped idempotency lookup, unique key, replay-safe response load, and duplicate request tests.

### FIN-DEADLOCK-004: Finance Writes Retry Deadlocks

Finance write paths must tolerate bounded PostgreSQL deadlock retries for `DeadlockDetected` / SQLSTATE `40P01`.

Required behavior:

1. Retry only the whole transaction unit.
2. Use bounded attempts and jittered backoff.
3. Do not retry after external side effects that cannot be replayed safely.
4. Log retry attempts with request ID and operation name.
5. Use either `@retry_on_deadlock(...)` around the transaction function or `with transaction_with_retry(...):` around the full write block.
6. Do not catch `DeadlockDetected` inside `tx_cursor()`, `session.begin()`, or any already-open transaction and then continue issuing SQL.

Why: local fullchain exposed deadlocks between backfill, balance reads, and withdrawal intent writes.

Agent repair instruction: wrap the transaction in the shared deadlock retry helper at the full transaction boundary. If the retry is block-scoped, use `transaction_with_retry(...)`; do not implement local try/except inside an open transaction.

### FIN-REVIEW-002: Approval Actions Use Enums, Not String Length

Approval commands such as `APPROVE`, `REJECT`, `HOLD`, `CANCEL`, `PAUSE`, `RESUME`, and `SUSPEND` must be validated by `Literal`, `Enum`, or a dedicated validator. `min_length` / `max_length` must not encode business action validity.

Why: a real schema bug blocked `REJECT` before the state machine because the string length rule was wrong.

Agent repair instruction: replace action strings with `Literal[...]` or Enum, then add regression coverage for every legal action.

### FIN-AUTH-005: Admin Execution Requires Permission, Step-Up, And Internal Token

Admin-front cannot authorize money movement by itself. Gateway-admin must enforce permission and step-up claims, then call Gateway internal APIs with the configured internal service token.

Required behavior:

1. Wrong internal token returns `INTERNAL_TOKEN_INVALID`.
2. Failed token checks do not mutate Gateway state or balances.
3. Public replies, refunds, withdrawals, and approvals require explicit human action where documented.
4. Audit records include actor, role, request ID, decision, note, and result.

### FIN-EVIDENCE-001: UI Smoke Is Not Finance Evidence

Funds approval release requires DB/API/chain/UI reconciliation. A page rendering or button click is not enough.

Required evidence:

1. Expected vs actual ticket atomic amount.
2. Expected vs actual provider USDC delta.
3. Expected vs actual vault USDC delta.
4. Expected vs actual DB status and tx hash.
5. Expected vs actual provider `pending` and `frozen` balances equal `0.000000` after complete.
6. Security checks: duplicate approval rejected, cross decision rejected, tampered ticket rejected, replay rejected, duplicate complete rejected.
7. Evidence digest bound to the finance-sensitive tree hash, not only the global commit SHA.

## CI Gates

Fast gates:

1. `npm run ci:finance-approval-safety`
2. `bash scripts/ci/finance_approval_safety_scan.sh`
3. `bash scripts/ci/finance_mypy_scan.sh`
4. `bash scripts/ci/local_runtime_guard_scan.sh`
5. `node scripts/ci/e2e_script_model_drift_scan.mjs`

The Semgrep gate catches explicit unsafe syntax and transaction-boundary hazards. The finance mypy gate catches implicit `float` data-flow pollution that syntax matching cannot reliably trace.

Heavy release gate:

1. `npm run e2e:admin-withdrawal-approval`
2. `npm run ci:finance-approval-e2e-evidence`

The heavy evidence gate is path-sensitive. README/docs-only edits do not invalidate the report; changes to Gateway finance, Gateway-admin approval, admin-front withdrawal review, contracts, or withdrawal E2E scripts do.

## Operational Invariants

Local runtime scripts must verify the real Postgres role/schema, not only port `5432`. A port-only probe can reuse the wrong database and create false pass/fail dogfood results.

Admin dogfood scripts must wait for a safe TOTP window before submitting step-up codes. Generating a code during the final seconds of a TOTP period creates flaky false failures.

E2E and reconcile scripts must document model-sensitive hardcoded status/table assumptions or import shared constants. Silent model drift can make a test pass or fail for the wrong reason.

## Historical Defects Now Covered

1. Approval moved state but not buckets: covered by `FIN-BUCKET-003` and E2E expected-vs-actual bucket checks.
2. Float returned from withdrawal creation: covered by `FIN-MONEY-001`.
3. Idempotency replay crashed on wrong response field: covered by idempotency/security E2E.
4. Postgres deadlock surfaced during fullchain: covered by `FIN-DEADLOCK-004`.
5. `REJECT` blocked by `min_length`: covered by `FIN-REVIEW-002`.
6. `restart_gateway.sh` reused the wrong Postgres: covered by local runtime guard.
7. TOTP last-window click flaked: covered by shared TOTP safe-window helper.
8. Provider balance model name drifted: covered by model-drift scan and report evidence.
