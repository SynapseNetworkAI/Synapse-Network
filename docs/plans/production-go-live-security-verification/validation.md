---
created_at: 2026-04-18
updated_at: 2026-04-18
doc_status: active
---

# Validation Route

This file is the evidence checklist for production launch. A checkbox without an evidence link is treated as incomplete.

## Staging Preflight Run

- Environment: `Staging preflight from local workspace`
- Source branch: `main`
- Source commit: `58dd322e`
- Run time: `2026-04-18 20:07:10 +08`
- Report: `docs/plans/production-go-live-security-verification/staging-verification-report.md`
- Plan status: `BLOCKED_NO_GO`
- Staging automation result: `PASS`
- Production launch decision: `NO-GO for production`
- Decision reason: repository-local gates passed and internal audit evidence is attached, but non-audit P0 production evidence is still missing.

## Required Checks

```bash
npm run ci:docs
npm run ci:pr
npm run ci:contracts
npm run ci:gateway
npm run ci:admin-gateway
npm run ci:frontend
npm run ci:admin-front
bash scripts/ci/security_money_scan.sh
bash scripts/ci/security_money_ts_scan.sh
bash scripts/ci/security_secret_scan.sh
npm run ci:release-go-no-go
npm run release:evidence:gateway-fullchain:staging
GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence
npm run e2e:withdrawal-one-ticket-evidence
npm run ci:withdrawal-one-ticket-evidence
npm run perf:local-production-load-rehearsal
npm run ci:local-production-load-evidence
```

## Repository and CI Gates

- [x] `npm run ci:docs` evidence: PASS, documentation validation passed.
- [x] `npm run ci:pr` evidence: PASS, full PR gate completed successfully.
- [x] Contract gate evidence: PASS, `npm run ci:contracts` ran 7 Hardhat security invariant tests.
- [x] Gateway gate evidence: PASS via `ci:pr`, `pytest` -> 322 passed, 86 skipped, 1 warning.
- [x] Gateway-admin gate evidence: PASS via `ci:pr`, `pytest` -> 94 passed.
- [x] Frontend/admin-front gate evidence: PASS via `ci:pr`; user-front lint/test/build passed, admin-front lint/build passed.
- [x] Money scan evidence: PASS, Python money scan and TypeScript money scan passed.
- [x] Secret scan evidence: PASS, secret scan passed.
- [x] Release Go/No-Go state check: PASS, `npm run ci:release-go-no-go` confirms staging automation evidence is recorded and production blockers remain explicit.
- [ ] Gateway full-chain release E2E evidence: NO-GO blocker, `npm run release:evidence:gateway-fullchain:staging` report not attached or not validated by `GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence`. Ordinary `ci:gateway` skip behavior is not accepted for release evidence.
- [ ] One-ticket withdrawal release evidence: NO-GO blocker, `npm run e2e:withdrawal-one-ticket-evidence` report not attached or not validated by `npm run ci:withdrawal-one-ticket-evidence`. The evidence must include all 10 scenarios: consumer/provider normal claim, expired reaper, soft revoke race claim, soft revoke expire, consumer replay attack, and provider low-gas revert retry.

## Contract and Chain Evidence

- [x] Internal audit report: PASS, `docs/security/SynapseCore_Internal_Production_Security_Audit_Report.md` attached. Independent third-party audit was not performed.
- [x] Audit finding closure log: PASS, `docs/security/SynapseCore_Internal_Audit_Closure_Log.md` attached.
- [x] Internal audit risk acceptance: PASS, `docs/security/SynapseCore_Internal_Audit_Risk_Acceptance.md` attached. This accepts internal-review risk for capped MVP production only.
- [x] Hardhat test output: PASS, `npm run ci:contracts` -> 7 passing.
- [ ] Fork test output: NO-GO blocker, fork test evidence not attached.
- [ ] Deployment dry-run output: NO-GO blocker, production/staging dry-run evidence not attached.
- [ ] ABI hash: NO-GO blocker, release ABI hash not attached.
- [ ] Bytecode hash: NO-GO blocker, release bytecode hash not attached.
- [ ] Source verification link: NO-GO blocker, verified explorer/source link not attached.
- [ ] Constructor args verification: NO-GO blocker, constructor args proof not attached.
- [ ] Production release manifest: NO-GO blocker, production release manifest not attached.
- [ ] Small-value chain rehearsal tx hashes: NO-GO blocker, tx evidence not attached.

## Financial Safety Evidence

- [x] Decimal/string/NUMERIC money contract verification: PASS, money scans passed and gateway test suite passed.
- [x] Idempotency and replay test evidence: PASS via gateway test suite coverage in `ci:pr`.
- [x] Transaction and rollback test evidence: PASS via gateway test suite coverage in `ci:pr`.
- [ ] Concurrency and no-overdraft test evidence: NO-GO blocker, production-grade concurrent money/load report not attached.
- [x] Deposit failure recovery evidence: PASS via gateway test suite coverage in `ci:pr`.
- [x] Refund failure recovery evidence: PASS via gateway test suite coverage in `ci:pr`.
- [x] Consumer withdrawal failure recovery evidence: PASS via gateway test suite coverage in `ci:pr`.
- [x] Provider withdrawal failure recovery evidence: PASS via gateway and gateway-admin test suite coverage in `ci:pr`.
- [ ] One-ticket withdrawal expected-vs-actual evidence: NO-GO blocker, release bundle must compare ticketHash, deadline, RPC block timestamp, DB status, consumer/provider balance delta, vault delta, replay result, and low-gas retry result.
- [ ] Ledger/vault reconciliation report: NO-GO blocker, release reconciliation report not attached.
- [ ] Gateway full-chain expected-vs-actual report: NO-GO blocker, release evidence for deposit, confirm, discovery, quote, invoke, provider credit, receipt, consumer withdrawal, analytics Kafka/ClickHouse ingestion, and reconciliation is not attached.
- [ ] Backup restore drill report: NO-GO blocker, restore drill evidence not attached.
- [ ] Chain-log replay or reconciliation drill: NO-GO blocker, chain-log replay evidence not attached.

## Gateway Security Evidence

- [x] Auth and owner/provider binding test evidence: PASS via gateway and gateway-admin test suite coverage in `ci:pr`.
- [x] Credential replay test evidence: PASS via gateway test suite coverage in `ci:pr`.
- [x] Budget and rate-limit test evidence: PASS via gateway test suite coverage in `ci:pr`.
- [x] Provider unhealthy drain evidence: PASS via gateway service health tests in `ci:pr`.
- [x] Provider slow lane probe evidence: PASS via gateway service health tests in `ci:pr`.
- [x] Force probe and Resume recovery evidence: PASS via gateway-admin provider services tests in `ci:pr`.
- [x] Timeout/body-limit/CORS evidence: PASS via gateway test suite coverage in `ci:pr`.
- [ ] SQL injection and SSRF test evidence: NO-GO blocker, dedicated production security test report not attached.
- [ ] JWT/header/path tampering evidence: NO-GO blocker, dedicated security test report not attached.
- [ ] Malicious provider response evidence: NO-GO blocker, dedicated adversarial provider report not attached.
- [x] Sanitized error and no-secret-leak evidence: PASS for repository scans, secret scan passed; production runtime error-surface drill remains covered by monitoring/security blockers.

## Admin Control Plane Evidence

- [x] RBAC and step-up test evidence: PASS via gateway-admin tests in `ci:pr`.
- [x] Admin audit evidence: PASS via gateway-admin tests in `ci:pr`.
- [x] Finance review evidence: PASS via gateway-admin tests in `ci:pr`.
- [x] Withdrawal review evidence: PASS via gateway-admin tests in `ci:pr`.
- [x] Refund approval evidence: PASS via gateway-admin tests in `ci:pr`.
- [x] Reconciliation drilldown evidence: PASS via gateway-admin tests in `ci:pr`.
- [x] Provider service management evidence: PASS via gateway-admin provider services tests in `ci:pr`.
- [x] No shadow-ledger review evidence: PASS by design review in staging report; gateway-admin tests consume projections/adapters, not runtime ledger mutation.

## Performance and Reliability Evidence

- [x] Local performance/reliability smoke evidence: PASS, `npm run ci:performance-reliability` verifies provider health probe concurrency and slow-lane scheduling; `npm run perf:local-reliability-suite` passed automation, scenario, docs, release-gate, staging-safety-guard, gateway health, and admin-front login checks with evidence at `docs/evidence/performance/20260418T130340Z-local-reliability-suite/report.md`. This does not replace production-like load, chaos, rollback, or restore reports.
- [ ] Local MVP production-load rehearsal evidence: NO-GO blocker for staging-prep, `npm run perf:local-production-load-rehearsal` report not attached or not validated by `npm run ci:local-production-load-evidence`. This local report must prove unique runId isolation, temporary wallet pool isolation, `chainNonceCollisionCount === 0`, bounded concurrency, graceful drain, no secret leakage, invoke/balance/deposit-confirm/withdrawal/provider-health/admin-finance lanes, and `0.000000` unexplained delta. It still does not replace staging capacity evidence.
- [ ] Discovery/quote/invoke load test: NO-GO blocker, load report not attached.
- [ ] Balance/deposit/withdrawal load test: NO-GO blocker, load report not attached.
- [ ] Provider health probe load test: NO-GO blocker, load report not attached.
- [ ] Admin analytics and finance view load test: NO-GO blocker, load report not attached.
- [ ] High-concurrency money test: NO-GO blocker, production-grade concurrency report not attached.
- [ ] Provider outage chaos drill: NO-GO blocker, chaos drill report not attached.
- [ ] Gateway restart chaos drill: NO-GO blocker, chaos drill report not attached.
- [ ] Gateway-admin restart chaos drill: NO-GO blocker, chaos drill report not attached.
- [ ] ClickHouse/Kafka outage drill: NO-GO blocker, chaos drill report not attached.
- [ ] RPC outage or slow RPC drill: NO-GO blocker, chaos drill report not attached.
- [ ] Postgres failover drill: NO-GO blocker, failover drill report not attached.
- [ ] Redis unavailable drill: NO-GO blocker, drill report not attached.
- [ ] Application rollback drill: NO-GO blocker, rollback drill report not attached.
- [ ] Config rollback drill: NO-GO blocker, rollback drill report not attached.
- [ ] Signer rollback procedure: NO-GO blocker, signer rollback procedure evidence not attached.

## Monitoring and Incident Evidence

- [ ] Gateway SLO dashboard: NO-GO blocker, production/staging dashboard link or screenshot not attached.
- [ ] Finance anomaly dashboard: NO-GO blocker, dashboard link or screenshot not attached.
- [ ] Chain event dashboard: NO-GO blocker, dashboard link or screenshot not attached.
- [ ] Provider health dashboard: NO-GO blocker, dashboard link or screenshot not attached.
- [ ] Database health dashboard: NO-GO blocker, dashboard link or screenshot not attached.
- [ ] Queue and analytics lag dashboard: NO-GO blocker, dashboard link or screenshot not attached.
- [ ] Security alert dashboard: NO-GO blocker, dashboard link or screenshot not attached.
- [ ] Alert drill screenshots or links: NO-GO blocker, alert drill evidence not attached.
- [ ] On-call route: NO-GO blocker, on-call route evidence not attached.
- [ ] Escalation policy: NO-GO blocker, escalation policy evidence not attached.
- [ ] Incident runbook: NO-GO blocker, incident runbook evidence not attached.
- [ ] Customer communication template: NO-GO blocker, customer communication template not attached.
- [ ] Postmortem template: NO-GO blocker, postmortem template not attached.

## Production Configuration Review

- [ ] Contract addresses: NO-GO blocker, production release manifest not attached.
- [ ] Chain id and RPC endpoints: NO-GO blocker, production release manifest not attached.
- [ ] USDC address: NO-GO blocker, production release manifest not attached.
- [ ] Owner/multisig: NO-GO blocker, multisig proof not attached.
- [ ] Platform signer: NO-GO blocker, signer proof not attached.
- [ ] CORS allowlist: NO-GO blocker, production config review not attached.
- [ ] JWT/TOTP/internal token handling: NO-GO blocker, production secret/config review not attached.
- [ ] DB TLS and least privilege: NO-GO blocker, production DB security review not attached.
- [ ] Backup policy: NO-GO blocker, production backup policy and restore proof not attached.
- [ ] Retention policy: NO-GO blocker, production retention policy not attached.
- [ ] Environment manifest: NO-GO blocker, environment manifest not attached.

## Sign-Off

- [ ] Engineering owner: NO-GO blocker, signature not attached.
- [ ] Security owner: NO-GO blocker, signature not attached.
- [ ] Finance/ledger owner: NO-GO blocker, signature not attached.
- [ ] Operations owner: NO-GO blocker, signature not attached.

## Final Decision

- Decision: `NO-GO for production`
- Decision time: `2026-04-18 20:07:10 +08`
- Release owner: `TBD`
- Notes: Staging automation passed and internal audit evidence is attached. Production launch remains blocked by explicit P0 evidence gaps listed above, including chain rehearsal, production config, load/chaos/restore, monitoring, and sign-off evidence.
