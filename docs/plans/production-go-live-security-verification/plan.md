---
created_at: 2026-04-18
updated_at: 2026-04-18
doc_status: active
---

# Execution Plan

## Scope

- Affected systems: contracts, gateway runtime, gateway-admin, user-front, admin-front, database, analytics/observability, CI, production operations.
- Primary gate: `docs/ops/10_Production_Go_No_Go_Security_Verification.md`.
- Evidence target: `validation.md` in this bundle.

## Change Set

- Documentation changes: production Go/No-Go gate, docs entrypoint links, and planning bundle.
- Verification changes: evidence checklist for contract, finance, gateway, admin, performance, monitoring, recovery, and sign-off.
- Runtime changes: none in this bundle.

## Phase 1 - Contract and Chain Custody

- Collect third-party audit report and closure evidence for all Critical, High, and Medium findings.
- Run Hardhat tests, fork tests, deployment dry-run, ABI hash verification, bytecode hash verification, source verification, and constructor argument verification.
- Validate contract invariants for deposit, withdraw, nonce, deadline, signer, fee pool, owner-only calls, and signer rotation.
- Complete a small-value chain rehearsal and attach tx hashes for deposit, invoke-linked settlement, withdrawals, and platform fee withdrawal.

## Phase 2 - Financial Ledger and Reconciliation

- Run money scan, secret scan, gateway tests, and finance-sensitive E2E tests.
- Verify all money paths use Decimal/string/NUMERIC semantics and reject float/number money arithmetic.
- Verify transactionality, row locking or atomic updates, durable idempotency, replay behavior, and append-only audit.
- Produce reconciliation reports for vault, ledger, provider payable, platform fee, pending, frozen, failed, rejected, cancelled, and completed states.
- Run backup restore and chain-log reconciliation drill.

## Phase 3 - Gateway Runtime Security

- Verify auth, owner binding, provider binding, credential scope, internal token scope, budget, rate limit, price assertion, and request replay behavior.
- Verify provider health routing: active healthy services are callable, unhealthy services are drained, inactive/deleted services are not probed automatically, slow lane works, and Force probe/Resume recovers a fixed endpoint.
- Run security tests for SQL injection, SSRF, path traversal, header injection, JWT tampering, credential replay, oversized body, malicious provider response, secret leak, and error leak.
- Verify timeout, concurrency, jitter, body limit, CORS, logging, and sanitized external errors.

## Phase 4 - Admin Control Plane

- Verify gateway-admin remains a control plane and does not write a shadow ledger.
- Verify admin-front consumes backend-owned projection/status semantics.
- Verify RBAC, step-up where required, reviewer identity, audit evidence, and traceability for high-risk actions.
- Validate finance review, withdrawal review, refund approval, reconciliation drilldown, provider service management, and force probe actions.

## Phase 5 - Performance, Reliability, and Recovery

- Run load tests for discovery, quote, invoke, balance, deposit confirm, withdrawal intent, provider health probes, admin analytics, and admin finance views.
- Run high-concurrency money tests for low-balance boundary, repeated request id, multiple agents, provider timeout, and DB lock contention.
- Run chaos drills for provider outage, gateway restart, gateway-admin restart, ClickHouse/Kafka outage, RPC outage, slow RPC, Postgres failover, Redis unavailable, and stale health.
- Run rollback drills for app rollback, config rollback, feature flag shutoff, provider drain, signer rollback, and database restore.

## Phase 6 - Monitoring, Alerts, and Sign-Off

- Verify dashboards and alerts for gateway SLOs, finance anomalies, chain events, provider health, database health, queue lag, analytics lag, and security signals.
- Trigger alert drills and attach screenshots or alert links.
- Attach incident runbook, escalation path, on-call routing, customer communication template, and postmortem template.
- Collect sign-off from engineering, security, finance/ledger, and operations owners.

## Completion Rule

All evidence must be attached in `validation.md`. Any unchecked item or missing evidence is a No-Go.
