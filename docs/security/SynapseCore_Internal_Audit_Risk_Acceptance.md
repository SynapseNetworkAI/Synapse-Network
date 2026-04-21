---
created_at: 2026-04-21
updated_at: 2026-04-21
doc_status: active
---

# SynapseCore Internal Audit Risk Acceptance

## Decision

Synapse accepts a founder/internal security audit as the MVP production audit
evidence for `SynapseCore` and the paired Gateway withdrawal lifecycle.

Independent third-party audit has not been performed. This is an explicit risk
acceptance, not a claim of third-party assurance.

## Accepted Risk

Accepted risk:

1. Internal review may miss issues that an independent specialist auditor would
   find.
2. Contract and Gateway correctness currently rely on internal tests, E2E
   evidence, code review, and guardrail checks.
3. MVP production must remain capped until third-party review or additional
   external assurance is completed.

Not accepted:

1. Any open Critical or High internal finding.
2. Any unexplained vault/ledger drift.
3. Any production hot-wallet sole control over owner or signer authority.
4. Any money path using float/number arithmetic.
5. Any production launch without monitoring, rollback, small-value rehearsal,
   and recovery evidence.

## MVP Launch Restrictions

The internal audit decision is valid only when all restrictions below are true:

1. Maximum single withdrawal cap is configured and documented in the release
   manifest.
2. Maximum daily withdrawal cap is configured and documented in the release
   manifest.
3. Platform signer and owner authority use multisig or hardware-backed custody
   before public production funds.
4. Small-value real-chain rehearsal is completed for deposit, Gateway
   confirmation, paid invoke, consumer withdrawal, provider withdrawal, and
   platform fee withdrawal.
5. Monitoring is live for vault/ledger delta, long-lived pending/frozen funds,
   withdrawal failure rate, failed-expired anomaly, signer changes, owner
   actions, RPC lag, and watcher lag.
6. Rollback, pause/drain, signer rotation, and customer communication runbooks
   are ready.

## Third-Party Audit Trigger Conditions

Independent third-party audit should be required before any of the following:

1. Public production launch with uncapped external users.
2. TVL exceeds the owner-approved MVP cap.
3. Single withdrawal cap exceeds the owner-approved MVP cap.
4. Daily withdrawal cap exceeds the owner-approved MVP cap.
5. Contract ABI changes after this report.
6. Withdrawal ticket signing, deadline, ticketHash, fee pool, signer rotation,
   or custody semantics change.
7. An incident occurs involving failed withdrawal, replay attempt, vault/ledger
   drift, signer compromise, or unexplained chain reconciliation anomaly.

## Sign-Off

| Role | Owner | Decision | Date | Notes |
| --- | --- | --- | --- | --- |
| Engineering owner | Founder/Internal Security Reviewer | Accepted for capped MVP only | 2026-04-21 | Requires remaining Go/No-Go evidence. |
| Security owner | Founder/Internal Security Reviewer | Accepted for capped MVP only | 2026-04-21 | Not third-party assurance. |
| Finance/Ledger owner | Founder/Internal Security Reviewer | Accepted for capped MVP only | 2026-04-21 | Requires reconciliation evidence before launch. |
| Operations owner | Founder/Internal Security Reviewer | Accepted for capped MVP only | 2026-04-21 | Requires monitoring, rollback, and recovery evidence. |

## Expiration

This risk acceptance expires when any contract or withdrawal lifecycle semantics
change, or 90 days after 2026-04-21, whichever comes first.

