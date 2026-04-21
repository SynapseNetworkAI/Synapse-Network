---
created_at: 2026-04-21
updated_at: 2026-04-21
doc_status: active
---

# SynapseCore Internal Production Security Audit Report

## Executive Summary

- Audit type: Founder/Internal Security Audit.
- Independent third-party audit: Not performed.
- Independent third-party audit was not performed.
- Audit target: `SynapseCore` custody contract, Gateway withdrawal ticket signing,
  provider/consumer withdrawal lifecycle, reaper/watcher behavior, finance
  guardrails, and withdrawal approval E2E evidence.
- Source commit reviewed: `f95d570e Harden single-ticket withdrawal flow`.
- Current conclusion: Production-ready for MVP only under explicit internal risk
  acceptance, withdrawal caps, monitoring, small-value chain rehearsal, and
  rollback/recovery readiness.
- Critical open findings: 0.
- High open findings: 0.
- Medium open findings: 0 open; accepted operational risks are documented.

This report is not a replacement for independent third-party assurance. It is an
internal production security review and must be presented as such in every
release checklist.

## Scope

The review covers:

1. Contract custody functions: `deposit`, `depositWithPermit`, `withdraw`,
   `withdrawPlatformFees`, `setSigner`, and `isTicketConsumed`.
2. Withdrawal ticket model: EIP-712 final digest, `ticketId`, `ticketHash`,
   deadline, signer verification, and replay guard.
3. Gateway lifecycle: `APPROVED_WAITING_CLAIM -> TICKET_ACTIVE -> COMPLETED`
   and `APPROVED_WAITING_CLAIM -> TICKET_ACTIVE -> FAILED_EXPIRED`.
4. Reaper and watcher behavior: chain-consumed lookup, RPC block timestamp
   finality margin, and failed-expired anomaly detection.
5. Admin and finance flows: manual approval, soft revoke waiting for expiry,
   audit trail, Decimal/string money contract, and bucket transitions.
6. Evidence gates: money scan, Semgrep finance safety, finance mypy, secret
   scan, diff coverage, contract tests, withdrawal approval E2E evidence, and
   one-ticket withdrawal release evidence.

Out of scope:

1. Independent third-party contract audit.
2. Mainnet production deployment review.
3. Production multisig custody ceremony.
4. Full production load, chaos, backup restore, alert drill, and sign-off.

## System Model

`SynapseCore` is intentionally small. It only accepts USDC deposits, executes
platform-signed withdrawal tickets, accrues protocol fees, exposes consumed
ticket state, allows signer rotation by owner, and lets the owner withdraw
accrued platform fees.

High-frequency balance checks, invoke debits, provider credits, withdrawal
approval, reaper logic, and reconciliation live off-chain in Gateway and
Gateway-admin. The contract is the final USDC custody boundary; the Gateway is
the policy and accounting control point.

The withdrawal evidence bundle for the one-ticket model must cover 10 scenarios:
consumer/provider normal claim, expiry reaper, soft revoke race claim, soft
revoke expiry, consumer replay attack, and provider low-gas on-chain revert
retry. The low-gas case intentionally sends a valid ticket with an insufficient
`gasLimit`; Gateway must not treat that failed receipt as a terminal business
failure while the ticket is still unconsumed and before deadline.

## Trust Boundaries

1. User wallet controls deposit and withdrawal transaction submission.
2. Platform signer controls whether a withdrawal ticket can be redeemed.
3. Contract owner controls signer rotation and platform fee withdrawal.
4. Gateway controls ticket issuance, withdrawal lifecycle, reaper/watcher state,
   idempotency, and audit.
5. Gateway-admin controls manual review only through Gateway-owned APIs and must
   not become a second ledger.
6. Postgres is the off-chain source of truth for ledger, audit, pending, frozen,
   and available balances.

## Threat Model

Reviewed threats:

1. Ticket replay after a successful withdrawal.
2. Expired ticket redemption.
3. Cross-chain or wrong-contract replay.
4. Amount, fee, signer, or ticket id tampering.
5. Platform fee withdrawal consuming customer principal.
6. Non-owner signer rotation.
7. Zero-address custody or signer deployment.
8. Double withdrawal from stale or duplicate ticket generation.
9. Reaper releasing funds before chain state is safely beyond deadline.
10. Soft revoke racing with on-chain claim.
11. Gateway or admin flow using float/number money arithmetic.
12. Audit trail loss for money-affecting admin actions.

## Findings Summary

| Severity | Open | Closed | Risk Accepted | Notes |
| --- | ---: | ---: | ---: | --- |
| Critical | 0 | 4 | 0 | Replay, signature, fee isolation, terminal-state safety reviewed. |
| High | 0 | 5 | 0 | Deadline, domain replay, owner-only controls, uniqueness, tamper rejection reviewed. |
| Medium | 0 | 3 | 1 | No hard revoke/broadcaster accepted with short TTL and reaper guardrails. |
| Low | 0 | 1 | 0 | Documentation and launch evidence policy updated. |
| Informational | 0 | 0 | 2 | Internal audit and MVP cap policy documented. |

Detailed finding status is tracked in
[SynapseCore_Internal_Audit_Closure_Log.md](./SynapseCore_Internal_Audit_Closure_Log.md).

## Verification Evidence

Required evidence for this internal audit:

1. `npm run ci:contracts`
   - Verifies deposit event, valid withdraw, ticket replay rejection, expired
     rejection, wrong signer rejection, empty ticket id rejection, tampered
     amount/fee rejection, fee pool isolation, and owner-only signer rotation.
2. `npm run ci:gateway`
   - Verifies Gateway unit and integration coverage for withdrawal ticket
     lifecycle, money codec, idempotency, reaper/watcher helpers, and related
     runtime behavior.
3. `npm run ci:finance-approval-safety`
   - Verifies money-sensitive Semgrep rules, finance-only mypy, runtime guard,
     and E2E script model drift checks.
4. `npm run ci:financial-security`
   - Verifies finance Semgrep safety plus finance-only mypy.
5. `npm run e2e:admin-withdrawal-approval`
   - Verifies admin approval flow across browser, Gateway-admin, Gateway,
     Postgres, signed ticket, and chain completion.
6. `npm run ci:finance-approval-e2e-evidence`
   - Verifies evidence digest and expected-vs-actual security comparisons.
7. `npm run ci:pr`
   - Verifies repository-wide PR gates, docs, stress review, frontend,
     admin-front, gateway, gateway-admin, provider service, and contracts.

Latest repository evidence before this report:

1. `ci:pr` passed during push of `f95d570e`.
2. Contracts gate passed with 7 Hardhat security invariant tests.
3. Gateway tests passed with 358 passed and 86 skipped in local CI.
4. Gateway-admin tests passed with 109 passed.
5. User-front tests passed with 194 passed.
6. Admin-front unit tests passed with 161 passed when run directly.
7. Provider service tests passed with 167 passed.
8. Admin withdrawal approval report succeeded at
   `output/dogfood/admin-withdrawal-approval/2026-04-20T075941909Z/`.

## Residual Risk

The following risks remain accepted for MVP only:

1. No independent third-party contract audit has been performed.
2. Internal review may miss issues that a specialist external auditor would
   catch.
3. Production deployment, multisig proof, source verification, and small-value
   chain rehearsal still require separate release evidence.
4. Load, chaos, backup restore, alert drill, and four-owner sign-off remain
   launch blockers outside this internal audit.

## MVP Production Restrictions

Internal audit evidence is sufficient only if all restrictions below are active:

1. Withdrawal caps are configured for maximum single withdrawal and daily total.
2. Platform signer and contract owner are controlled by multisig or
   hardware-backed custody before public production funds.
3. Small-value real-chain rehearsal is completed and linked in release evidence.
4. Reaper/watcher monitoring is live for long-lived pending/frozen funds,
   failed-expired anomalies, unmatched withdrawal events, signer changes, and
   vault/ledger deltas.
5. Rollback, pause/drain, and customer communication runbooks are ready.
6. Any increase in TVL, external customer exposure, or withdrawal caps triggers
   renewed audit review and should trigger independent third-party audit.

## Conclusion

`SynapseCore` and the paired Gateway one-ticket withdrawal lifecycle are suitable
for constrained MVP production under internal risk acceptance. This decision is
not equivalent to independent third-party assurance. The production launch
decision remains blocked until the non-audit P0 release evidence in the
Go/No-Go checklist is attached.
