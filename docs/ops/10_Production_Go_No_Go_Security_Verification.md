# Production Go / No-Go Security Verification

- Status: canonical
- Code paths: `contracts/`, `services/gateway/`, `services/gateway-admin/`, `services/user-front/`, `services/admin-front/`, `scripts/ci/`, `docs/plans/production-go-live-security-verification/`
- Verified with: `npm run ci:docs`
- Last verified against code: 2026-04-22

This document is the production launch gate for Synapse Network.

Production launch is allowed only when every P0 gate below has passed and the release evidence bundle is complete. If any P0 item fails, is unverified, or has no evidence link, the release is a **No-Go**.

Current MVP audit policy: Synapse may use a founder/internal security audit with explicit risk acceptance instead of an independent third-party audit for capped MVP production. This must never be represented as third-party assurance. If no independent third-party audit was performed, launch evidence must include the internal audit report, closure log, risk acceptance, withdrawal caps, monitoring evidence, rollback/recovery runbooks, and small-value chain rehearsal.

## Launch Principles

1. Customer principal must not be transferable by the platform, a Provider, a replayed request, or an attacker.
2. Platform funds, provider receivables, customer balances, pending funds, frozen funds, and on-chain vault state must be reconcilable.
3. Every money movement must be traceable across request id, idempotency key, correlation id, ledger row, audit row, and chain transaction when applicable.
4. Every production incident must be detectable, triageable, auditable, and recoverable.
5. Manual promises do not replace evidence. Missing evidence means failed verification.

## P0 Go / No-Go Gates

### 1. Blockchain and Smart Contracts

- Security audit evidence is complete. For internal/founder audit mode, the evidence must include an internal audit report, closure log, explicit risk acceptance, and capped-MVP launch restrictions. All Critical and High findings must be closed. Medium findings must be closed or risk-accepted with mitigation. Any accepted Low or Informational finding must have written risk acceptance.
- `SynapseCore` passes Hardhat tests, fork tests, deployment dry-run, ABI hash verification, bytecode hash verification, source verification, and constructor argument verification. Staging contract evidence must include `npm run deploy:contracts:arbitrum-sepolia:dry-run`, `npm run deploy:contracts:arbitrum-sepolia`, and `npm run ci:contract-deployment-evidence`.
- Core contract invariants are verified:
  - deposit only transfers USDC into the vault and emits the expected event.
  - withdraw requires a valid platform signature, unique ticket id, unexpired deadline, and correct chain/domain.
  - ticket replay, deadline replay, amount tampering, fee tampering, signer tampering, and chain id mismatch all fail.
  - protocol fee only accrues to `platformFeePool`.
  - platform fee withdrawal cannot consume customer principal.
- Malicious and edge scenarios are tested: reentrancy, fake token, invalid signer, signer rotation, owner-only methods, zero amount, excessive amount, failed token transfer, and wrong network.
- Production owner and signer authority use multisig or hardware-backed custody. A single hot wallet must not control production contract authority.
- Staging contract deployment evidence records Arbitrum Sepolia chain id, owner-only MockUSDC address, Synapse contract address, deployer, owner, platform signer, ABI hash, bytecode hash, source verification link, deployment transactions, wallet gas preflight, and MockUSDC pre-mint balances.
- Production contract release manifest records chain id, USDC address, Synapse contract address, deployer, owner, multisig, platform signer, ABI hash, bytecode hash, source verification link, and deployment transaction.
- A small-value real-chain rehearsal is completed: deposit, gateway confirmation, paid invoke, consumer withdrawal, provider withdrawal, and platform fee withdrawal.
- If an independent third-party audit was not performed, MVP production must use explicit withdrawal caps, signer/owner custody controls, monitoring alerts, manual rollback procedures, and documented owner risk acceptance.

### 2. Financial System and Ledger Safety

- The money contract is enforced end to end: database stores money as `NUMERIC(36, 6)`, Python computes with `Decimal`, HTTP/JSON sends money as strings, and business logic never uses `float` or JavaScript money numbers.
- All money mutations run in one transaction and use row-level locks or atomic conditional updates.
- Deposit, invoke debit, provider credit, refund, consumer withdrawal, provider withdrawal, and platform fee operations have stable idempotency keys and durable uniqueness.
- Replay requests return stable semantics and never duplicate ledger writes, balance changes, settlement credits, refunds, or withdrawals.
- Concurrent financial tests prove no overdraft, duplicate charge, negative balance, duplicate provider credit, or duplicate withdrawal completion.
- Ledger and audit are append-only for money-affecting operations and preserve actor, owner/provider, request id, idempotency key, correlation id, before, after, delta, status, reason, tx hash, and timestamp.
- Vault reconciliation succeeds across on-chain vault balance, customer principal, provider payable, platform fee pool, pending funds, frozen funds, completed withdrawals, and failed/rejected/cancelled states.
- Failure paths are recoverable: wallet rejection, chain receipt failure, missing completion callback, watcher downtime, provider timeout, DB transaction rollback, analytics outage, and RPC outage.
- Backup and restore drill proves balances can be reconstructed from database backup plus chain events and reconciled against the current ledger.

### 3. Gateway Runtime Security

- Privileged surfaces default deny. Missing token, invalid token, expired token, wrong owner, wrong provider, wrong credential, wrong scope, and wrong internal token all fail closed.
- Agent invoke verifies credential, owner balance, price assertion, service active state, runtime health, budget cap, rate limit, idempotency, and replay protection.
- Discovery and invoke only route callable services: `isActive=true`, `status=active`, non-stale runtime health, and at least one healthy target.
- Provider health semantics are verified:
  - unhealthy services are auto-drained from discovery/invoke.
  - unhealthy services are not automatically changed to `inactive`.
  - long-term unhealthy services enter slow lane probing instead of consuming normal probe capacity.
  - Force probe and Resume can restore a recovered active service.
- Gateway protections are verified: global probe concurrency limit, jitter scheduling, provider timeout, upstream timeout, body size limit, rate limit, CORS allowlist, sanitized error surface, and safe logging.
- Security tests cover SQL injection, SSRF, path traversal, header injection, JWT tampering, credential replay, idempotency collision, oversized body, malicious provider response, stack trace leak, and secret leak.
- Production secrets come only from approved secret storage or environment injection. Private keys, JWT secrets, internal tokens, TOTP secrets, and API keys must not appear in git, frontend bundles, logs, screenshots, or external errors.

### 4. Admin Control Plane and Auditability

- `gateway-admin` remains a control plane and must not become a second ledger.
- `admin-front` displays backend-owned status and must not invent finance, approval, withdrawal, refund, or reconciliation semantics.
- High-risk admin operations enforce RBAC, step-up authentication where required, reviewer identity from trusted server context, and append-only admin audit.
- Provider withdrawal review, consumer withdrawal review, refund approval, deposit repair, reconciliation, service pause/resume/suspend/delete, and force probe are traceable.
- Admin audit records who acted, when, on what resource, with what decision, why, and with what result.
- Operators can trace incidents by owner, provider, tx hash, request id, correlation id, invocation id, withdrawal id, refund id, service id, and credential id.

### 5. Performance, Stability, and Reliability

- Load tests cover discovery, quote, invoke, balance, deposit confirm, withdrawal intent, provider health probing, admin analytics, and admin finance views.
- Minimum production launch targets are met or explicitly tightened in the release checklist:
  - invoke p95 below 500 ms.
  - invoke p99 below 1500 ms.
  - gateway 5xx rate below 0.1%.
  - financial paths produce no negative balance, duplicate debit, duplicate credit, or unexplained balance drift.
- High-concurrency money tests cover the same owner with multiple agents, repeated request ids, low-balance boundary, provider timeout, DB lock contention, and watcher catch-up.
- Degradation tests prove analytics/Kafka/ClickHouse outage does not block money source-of-truth paths.
- Database reliability is verified: connection pool limits, slow query alerts, lock wait alerts, deadlock detection, transaction timeout, index coverage, backup, and restore.
- Chaos drills cover provider outage, gateway restart, gateway-admin restart, ClickHouse/Kafka outage, RPC outage, slow RPC, Postgres failover, Redis unavailable, and stale health snapshots.
- Rollback drills cover application rollback, config rollback, feature-flag shutoff, provider drain, signer rollback procedure, and database restore.

### 6. Monitoring, Alerting, and Incident Response

- Dashboards exist for gateway QPS, latency, error rate, DB pool, lock wait, deadlock, provider health, invoke success rate, balance mutation count, withdrawal/refund/deposit status, watcher progress, and queue lag.
- Financial anomaly alerts exist for negative-balance attempts, duplicate request id spikes, ledger-vault delta, long-lived pending/frozen funds, large withdrawals, withdrawal failure rate, refund failure rate, and deposit failure spikes.
- Chain alerts exist for unconfirmed deposits, unmatched withdrawal events, signer change, owner action, platform fee pool anomaly, USDC transfer failure, RPC lag, and watcher lag.
- Security alerts exist for auth failure spikes, credential replay, rate-limit spikes, internal token failures, admin login anomalies, MFA anomalies, and secret scan failures.
- SLO alerts exist for invoke p95/p99, 5xx rate, provider timeout rate, DB pool exhaustion, Kafka lag, ClickHouse lag, health monitor checked/skipped anomaly, and analytics ingestion degradation.
- On-call channel, escalation path, incident template, stop-the-bleed checklist, customer communication template, and postmortem template are ready.
- Alert drills are completed for provider unhealthy, deposit failed, budget blocked, gateway 5xx, DB pool exhaustion, duplicate request spike, and chain watcher lag.

## Required Verification Package

The release owner must attach evidence for every item below before requesting launch approval.

1. Contract security audit evidence, finding closure log, Hardhat/fork test output, deployment dry-run output, release manifest, verified contract link, and small-value chain rehearsal report. If the audit is internal/founder-led, attach the internal audit report and explicit risk acceptance and state that no independent third-party audit was performed.
2. CI evidence for `ci:pr`, `ci:contracts`, `ci:gateway`, `ci:admin-gateway`, `ci:frontend`, `ci:admin-front`, money scan, secret scan, and docs check.
3. Gateway full-chain release E2E report for deposit, confirm, discovery, quote, invoke, provider credit, receipt, consumer withdrawal, analytics Kafka/ClickHouse ingestion, and reconciliation. Run `npm run release:evidence:gateway-fullchain:staging` and validate it with `GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence`; skipped tests are not accepted as release evidence.
4. One-ticket withdrawal release evidence for 10 scenarios: consumer/provider normal claim, expired reaper, soft revoke race claim, soft revoke expire, consumer replay attack, and provider low-gas revert retry. Run `npm run e2e:withdrawal-one-ticket-evidence` and validate it with `npm run ci:withdrawal-one-ticket-evidence`.
5. Reconciliation report for on-chain vault, internal ledger, provider payable, platform fee, pending funds, frozen funds, and completed withdrawals.
6. Security test report for auth/RBAC, replay, rate limit, SQL injection, SSRF, secret leak, error leak, and malicious provider response.
7. Performance and reliability report for load tests, concurrent money tests, chaos drills, and rollback drills.
8. Monitoring evidence: dashboard screenshots, alert screenshots, incident runbook links, on-call routing proof, and alert drill notes.
9. Data recovery evidence: Postgres backup restore drill, ClickHouse restore freshness proof, RPO/RTO result, and operator notes. v1 restore evidence must not require Postgres-to-ClickHouse row-to-row equality or RPC chain replay.
10. Production configuration review: environment, contract addresses, RPC endpoints, CORS, JWT/TOTP/internal tokens, database TLS, least-privilege accounts, backup policy, and retention policy.
11. Approval signatures from engineering, security, finance/ledger, and operations owners.

Provider withdrawal approval evidence is mandatory for any release that includes funds approval or withdrawal-review changes:

1. `npm run ci:finance-approval-safety`
2. `npm run e2e:admin-withdrawal-approval`
3. `npm run ci:finance-approval-e2e-evidence`

The evidence report must contain the finance-sensitive tree hash, fixture hash, evidence digest, expected-vs-actual DB/API/chain/UI comparisons, and security checks for duplicate approval, cross decision, tampered ticket, replayed ticket, and duplicate complete.

One-ticket withdrawal evidence is mandatory for any release that changes
`SynapseCore.withdraw`, ticket signing, consumer/provider withdrawal completion,
reaper, watcher, or `FAILED_EXPIRED` semantics:

1. `npm run e2e:withdrawal-one-ticket-evidence`
2. `npm run ci:withdrawal-one-ticket-evidence`

The evidence report must contain 10 scenario JSON files and expected-vs-actual
checks for replay rejection, low-gas failed receipt retry, RPC deadline margin,
ticketHash, DB status, and balance/vault deltas.

## Hard Stop Rules

Any item below is an automatic No-Go:

- Critical or High contract security audit finding remains open.
- Production owner/signer authority is controlled by a single hot wallet.
- Any money business path uses `float` or JavaScript number arithmetic.
- Any money mutation lacks transaction, idempotency, audit, or concurrency protection.
- Vault and ledger reconciliation has unexplained drift.
- Failed deposit, refund, or withdrawal cannot be tracked and recovered.
- High-risk admin action lacks RBAC, step-up requirement when applicable, or audit evidence.
- Secret material appears in git, logs, frontend bundles, screenshots, or external errors.
- Production monitoring or alerting has not been drill-tested.
- Backup restore has not been drill-tested.
- Backup restore evidence is older than 72 hours, digest-invalid, or missing restored Postgres reconciliation and ClickHouse freshness proof.
- Load or concurrency tests produce overdraft, duplicate debit, duplicate credit, or unexplained balance drift.
- Internal audit risk acceptance is missing while no independent third-party audit was performed.
- Provider withdrawal approval evidence is missing, stale, hand-edited, or fails its finance-sensitive tree hash / digest validation.
- One-ticket withdrawal evidence is missing, stale, hand-edited, lacks any of the 10 scenario JSON files, or fails replay / low-gas retry checks.
- Rollback, incident, or customer communication runbook is missing.
- `ci:pr` or a required release evidence item fails.

## Approval Rule

Launch approval requires all P0 gates to pass, all required evidence links to be attached, and all four approval owners to sign off.

If any evidence is missing, stale, ambiguous, or unverifiable, the correct decision is **No-Go**.
