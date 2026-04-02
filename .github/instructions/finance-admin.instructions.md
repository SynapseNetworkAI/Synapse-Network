---
description: "Use when writing or modifying gateway-admin finance review, finance approval, withdrawal review, refund approval, deposit repair approval, reconciliation drilldown, or finance-admin execution code. Covers admin control-plane money review semantics, reviewer permissions, audit evidence, and backend-owned decision flows."
applyTo:
  - "services/gateway-admin/src/api/routers/provider_withdraw_review.py"
  - "services/gateway-admin/src/api/routers/approval.py"
  - "services/gateway-admin/src/api/routers/dashboard.py"
  - "services/gateway-admin/src/api/schemas/approval.py"
  - "services/gateway-admin/src/api/schemas/provider_withdraw_review.py"
  - "services/gateway-admin/src/services/approval/**/*.py"
  - "services/gateway-admin/src/services/finance_admin/**/*.py"
  - "services/gateway-admin/src/services/adapters/provider_withdraw_review.py"
  - "services/gateway-admin/src/storage/analytics/provider_withdraw_review.py"
  - "services/gateway-admin/tests/test_app.py"
  - "services/gateway-admin/tests/test_execution_service.py"
  - "services/gateway-admin/tests/test_execution_worker.py"
name: "Synapse Finance Admin Rules"
---

# Synapse Finance Admin Rules

## Scope

- This file is narrower than `finance-backend.instructions.md`.
- It applies to `services/gateway-admin` finance review and approval flows where operators review, approve, reject, retry, or inspect money-affecting actions.

## Boundary

- `gateway-admin` is a control plane, not the settlement runtime.
- It may review, authorize, route, retry, or audit finance-sensitive actions, but it must not become a shadow ledger.
- Backend decisions and projections remain the source of truth; the admin frontend must not invent finance-review semantics.

## Decision Flow Rules

- Approval and withdrawal-review decisions must remain explicit and auditable.
- Reviewer actions should map to stable backend-owned statuses and commands.
- Avoid mixing queue semantics, review semantics, and execution semantics into one ambiguous status.
- If a decision triggers downstream execution, keep the review record and execution record clearly separated.

## Permission and Step-Up Discipline

- High-risk finance decisions must enforce reviewer permission boundaries explicitly.
- If step-up authentication is required for a flow, keep it mandatory and visible in code paths.
- Never trust frontend-provided role or reviewer identity for approval decisions.

## Audit Evidence

- Finance review code must preserve who reviewed, what was decided, when it was decided, and why.
- Decision notes, comments, rejection reasons, and execution attempt records should remain traceable.
- Do not collapse audit evidence into UI-only formatting or transient fields.

## Status and Projection Semantics

- Treat approval queue items, withdrawal review items, review history, and execution jobs as related but distinct read models.
- Reconciliation, deposit repair, refund approval, and withdrawal review semantics should stay backend-owned and projection-driven.
- If dashboard or list pages need a new derived finance status, define it in backend contract or projection logic first.

## Retry and Execution Rules

- Retry flows must remain idempotent and auditable.
- A retry should not erase prior attempts or reviewer decisions.
- Execution job history should preserve attempt order, outcome, and operator context when applicable.

## Testing Expectations

- Update contract tests when approval, withdrawal review, or reconciliation semantics change.
- Cover permission denial, reviewer routing, decision success, retry behavior, and projection-backed listing behavior.
- When status naming or queue semantics change, update docs and tests in the same change.

## ⚠️ Gotchas — Known Finance-Admin Failure Patterns

**Shadow ledger drift**
- Adding derived balance or settlement totals directly to an admin query instead of consuming the backend-owned projection. The admin control plane must not become a second source of settlement truth.

**Audit evidence collapse**
- Collapsing `reviewer_id`, `reviewed_at`, and `reason` into a single JSON blob or display string. These are separate queryable fields for compliance.
- Overwriting a prior review decision instead of appending a new decision record. Review history must be append-only.

**Step-up auth omission**
- High-value withdrawal approvals that call the execution path directly without verifying the reviewer's step-up auth claim. Never trust the caller's role assertion; verify the token scope server-side.

**Approval ↔ execution conflation**
- Storing approval state and execution state in the same row and checking a single `status` field for both. Keep the approval record and execution job as distinct rows with a foreign key; they evolve independently.

**Retry without idempotency**
- A retry endpoint that creates a new execution record on every call without checking whether a prior attempt already succeeded. Idempotency keys are mandatory on retry paths.