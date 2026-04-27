---
created_at: 2026-04-18
updated_at: 2026-04-27
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

## Staging Validation Refresh

- Environment: `Staging Cloud Run + Cloud SQL + Arbitrum Sepolia`
- Source branch: `codex/staging-deploy-tags-alerts-hardening`
- Source commit: `98e95ab7`
- Run time: `2026-04-26 10:43:42 +08`
- Plan status: `STAGING_PARTIAL_PASS_PRODUCTION_NO_GO`
- Staging automation result: `PASS for L0/L1/full-chain/withdrawal-review core gates`
- Production launch decision: `NO-GO for production`
- Decision reason: fresh staging smoke, Lark, contract, gateway full-chain, Gmail, GCP alert, and withdrawal-review evidence now exist, but backup restore, staging load, chaos/recovery, dedicated adversarial security evidence, production config, dashboards/on-call, and sign-off remain incomplete.

Fresh staging evidence:

- [x] Staging smoke: `docs/evidence/staging/smoke/20260426T015639Z-staging-smoke`, validated by `npm run ci:staging-smoke-evidence`.
- [x] Arbitrum Sepolia contract evidence: `docs/evidence/release/contracts/arbitrum-sepolia/20260424T062942120Z-deploy`, revalidated on `2026-04-26` with live RPC by `npm run ci:contract-deployment-evidence`.
- [x] Lark E2E: `docs/evidence/alerts/lark/20260426T015841Z-lark-e2e`, validated by `npm run ci:lark-alert-e2e-evidence`.
- [x] Gateway full-chain staging MVP profile: `docs/evidence/release/gateway-fullchain/20260426T020914Z-staging`, validated by `GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence`.
- [x] Staging core dogfood: `docs/evidence/staging/core-dogfood/2026-04-25T021028255Z-staging-core-dogfood`, validated by `npm run ci:staging-core-dogfood-evidence`.
- [x] Withdrawal review dogfood staging: `docs/evidence/staging/withdrawal-review-dogfood/2026-04-26T024342306Z-staging-withdrawal-review-dogfood`, validated by `npm run ci:withdrawal-review-dogfood-staging-evidence`.
- [x] Gmail staging E2E: `docs/evidence/staging/gmail/20260425T001405Z-gmail-staging-e2e`, validated by `npm run ci:gmail-notifications-staging-evidence`.
- [x] GCP Monitoring to gateway-admin to Lark staging drill: `docs/evidence/staging/gcp-alerts/20260425T103854Z-gcp-alerts-staging`, validated by `npm run ci:gcp-alerts-staging-evidence`.
- [x] Local withdrawal review dogfood: `output/dogfood/withdrawal-review/2026-04-25T041223618Z-local-withdrawal-review-dogfood`, validated by `npm run ci:withdrawal-review-dogfood-local-evidence`.
- [x] Local one-ticket withdrawal evidence: `docs/evidence/release/withdrawal-one-ticket/20260421T100345Z-local`, validated by `npm run ci:withdrawal-one-ticket-evidence`.
- [x] Local MVP production-load rehearsal: `docs/evidence/performance/20260421T110801Z-local-production-load-rehearsal`, validated by `npm run ci:local-production-load-evidence`.

## Staging Backup/Load Refresh

- Environment: `Staging Cloud Run + Cloud SQL + Provider runtime`
- Source branch: `main`
- Source commit: `7ef9e0b7`
- Run time: `2026-04-27 17:16:33 +08`
- Plan status: `STAGING_BACKUP_LOAD_PASS_PRODUCTION_NO_GO`
- Staging automation result: `PASS for backup restore and light-load MVP gates`
- Production launch decision: `NO-GO for production`
- Decision reason: staging backup restore and light-load MVP evidence now exist, but chaos/recovery, adversarial security, production config, dashboards/on-call, and owner sign-off remain incomplete.

Additional fresh staging evidence:

- [x] Backup restore staging drill: `docs/evidence/recovery/20260427T082355Z-backup-restore-drill`, validated by `npm run ci:backup-restore-evidence`. The drill restored the latest Cloud SQL backup to an isolated temporary Cloud SQL instance, validated Postgres critical tables, produced reconciliation summary, and deleted the temporary restore instance.
- [x] Staging load suite: `docs/evidence/performance/20260427T091633Z-staging-load-suite`, produced by `npm run perf:staging-load-suite` with `SYNAPSE_PERF_DURATION_SEC=30`. The suite covered Gateway discovery/invoke, finance balance read-only, provider health read-only, and admin read-only routes with zero failures. Destructive money-write load remained intentionally disabled.

Resolved staging defects during this refresh:

- [x] Staging Gateway schema drift: `synapse_service_quotes_quoted_price_usdc_check` rejected zero-price staging services until `synapse-staging-db-migrate-rn4k8` reapplied the Git-tracked target schema.
- [x] Provider registry drift: provider services were re-onboarded to `https://provider-staging.synapse-network.ai/provider-services/*/invoke` and verified discoverable/healthy.
- [x] Gateway-to-Provider signature drift: `synapse-staging-provider-signature-secret` was rotated to a newline-free value and both Gateway and Provider were rolled to fresh revisions.
- [x] Provider runtime DB wiring: `synapse-staging-provider` was bound to Cloud SQL and provider-side Postgres schema was applied before the load suite.
- [x] Drift prevention gate added: Gateway deploys now run migration/schema
  validation on every Gateway rollout, enforce the `quoted_price_usdc >= 0`
  free-service contract, lint newline-sensitive staging secrets, verify
  Gateway/Provider shared signature secret wiring, verify Provider Cloud SQL
  attachment and endpoint prefix, and record the result in release manifest
  `driftGuard`.

Remaining staging gaps:

- [ ] Chaos/recovery drills: intentionally deferred until backup restore and staging load are green, then must be followed by smoke plus reconciliation.
- [ ] Dedicated adversarial security evidence: SQLi, SSRF, JWT/header/path tampering, and malicious provider response reports are not attached.
- [ ] Production-only launch controls: production release manifest, multisig/owner proof, prod config review, dashboards, on-call/escalation, incident runbooks, and owner sign-off remain NO-GO.

## Required Checks

```bash
npm run ci:docs
npm run ci:pr
npm run ci:contracts
npm run deploy:contracts:arbitrum-sepolia:dry-run
npm run ci:contract-deployment-evidence
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
npm run ci:monitoring-alert-rules
SYNAPSE_DRILL_ENV=staging SYNAPSE_DRILL_CONFIRM=I_UNDERSTAND_THIS_CHANGES_STAGING npm run drill:backup-restore:staging
npm run ci:backup-restore-evidence
```

## Repository and CI Gates

- [x] `npm run ci:docs` evidence: PASS, documentation validation passed.
- [x] `npm run ci:pr` evidence: PASS, full PR gate completed successfully.
- [x] Contract gate evidence: PASS, `npm run ci:contracts` ran 8 Hardhat security invariant tests.
- [x] Gateway gate evidence: PASS via `ci:pr`, `pytest` -> 322 passed, 86 skipped, 1 warning.
- [x] Gateway-admin gate evidence: PASS via `ci:pr`, `pytest` -> 94 passed.
- [x] Frontend/admin-front gate evidence: PASS via `ci:pr`; user-front lint/test/build passed, admin-front lint/build passed.
- [x] Money scan evidence: PASS, Python money scan and TypeScript money scan passed.
- [x] Secret scan evidence: PASS, secret scan passed.
- [x] Release Go/No-Go state check: PASS, `npm run ci:release-go-no-go` confirms staging automation evidence is recorded and production blockers remain explicit.
- [x] Monitoring alert rule static gate: PASS, `npm run ci:monitoring-alert-rules` validates Prometheus rule structure, drill labels, and Grafana dashboard JSON.
- [x] Gateway full-chain release E2E evidence: PASS, `docs/evidence/release/gateway-fullchain/20260426T020914Z-staging` validated by `GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence`. The bundle includes `trace.jsonl`, matching `traceDigest`, staging environment, and zero failed reconciliation checkpoints.
- [x] One-ticket withdrawal release evidence: PASS, `docs/evidence/release/withdrawal-one-ticket/20260421T100345Z-local` validated by `npm run ci:withdrawal-one-ticket-evidence`. This is local release evidence, not staging chain evidence.

## Contract and Chain Evidence

- [x] Internal audit report: PASS, `docs/security/SynapseCore_Internal_Production_Security_Audit_Report.md` attached. Independent third-party audit was not performed.
- [x] Audit finding closure log: PASS, `docs/security/SynapseCore_Internal_Audit_Closure_Log.md` attached.
- [x] Internal audit risk acceptance: PASS, `docs/security/SynapseCore_Internal_Audit_Risk_Acceptance.md` attached. This accepts internal-review risk for capped MVP production only.
- [x] Hardhat test output: PASS, `npm run ci:contracts` -> 8 passing.
- [x] Arbitrum Sepolia staging deployment evidence: PASS, `docs/evidence/release/contracts/arbitrum-sepolia/20260424T062942120Z-deploy` validated by `npm run ci:contract-deployment-evidence` with live Arbitrum Sepolia RPC on `2026-04-26`. Current E2E wallet balances may be lower than initial pre-mint because staging dogfood spends MockUSDC; deployment-time pre-mint evidence remains valid.
- [ ] Fork test output: NO-GO blocker, fork test evidence not attached.
- [ ] Deployment dry-run output: NO-GO blocker, `npm run deploy:contracts:arbitrum-sepolia:dry-run` or production dry-run evidence not attached.
- [x] ABI hash: PASS through Arbitrum Sepolia contract deployment evidence.
- [x] Bytecode hash: PASS through Arbitrum Sepolia contract deployment evidence.
- [x] Source verification link: PASS through Arbitrum Sepolia contract deployment evidence.
- [x] Constructor args verification: PASS through Arbitrum Sepolia contract deployment evidence.
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
- [x] One-ticket withdrawal expected-vs-actual evidence: PASS, `docs/evidence/release/withdrawal-one-ticket/20260421T100345Z-local` covers ticket hash/deadline/status/balance/replay/low-gas retry locally. Staging one-ticket evidence remains covered through full-chain and withdrawal-review dogfood, not the local one-ticket bundle.
- [x] Ledger/vault reconciliation report: PASS for staging MVP profile, `docs/evidence/release/gateway-fullchain/20260426T020914Z-staging` reports zero reconciliation failures and validated trace digest.
- [x] Gateway full-chain expected-vs-actual report: PASS, `docs/evidence/release/gateway-fullchain/20260426T020914Z-staging` covers deposit, discovery/quote, invoke, provider credit, consumer withdrawal, outbox/projection evidence, and reconciliation under the MVP Postgres profile.
- [x] Backup restore drill report: PASS for staging MVP, `docs/evidence/recovery/20260427T082355Z-backup-restore-drill` validated by `npm run ci:backup-restore-evidence`. ClickHouse/Kafka restore is not an MVP blocker while those systems are not deployed.
- [ ] Chain-log reconciliation drill: NO-GO blocker, daily chain reconciliation evidence not attached. This is independent of v1 backup/restore drill and must not be coupled to restore evidence.

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
- [x] Local MVP production-load rehearsal evidence: PASS, `docs/evidence/performance/20260421T110801Z-local-production-load-rehearsal` validated by `npm run ci:local-production-load-evidence`. This local report does not replace staging capacity evidence.
- [x] Discovery/quote/invoke load test: PASS for staging MVP, `docs/evidence/performance/20260427T091633Z-staging-load-suite/gateway-load` reports 15/15 requests successful, including 10/10 `agent-invoke` calls.
- [x] Balance read-only load test: PASS for staging MVP, `docs/evidence/performance/20260427T091633Z-staging-load-suite/finance-load` reports 22/22 owner balance requests successful. Destructive deposit/withdrawal write-load remains opt-in and was not run.
- [x] Provider health probe load test: PASS for staging MVP, `docs/evidence/performance/20260427T091633Z-staging-load-suite/provider-health-load` reports 19/19 provider health/admin provider-service requests successful.
- [x] Admin analytics and finance view load test: PASS for staging MVP, `docs/evidence/performance/20260427T091633Z-staging-load-suite/admin-load` reports 20/20 admin read-only requests successful across analytics overview, data quality, withdrawal reviews, and provider services.
- [ ] High-concurrency money test: NO-GO blocker, production-grade concurrency report not attached.
- [ ] Provider outage chaos drill: NO-GO blocker, chaos drill report not attached.
- [ ] Gateway restart chaos drill: NO-GO blocker, chaos drill report not attached.
- [ ] Gateway-admin restart chaos drill: NO-GO blocker, chaos drill report not attached.
- [ ] Analytics outbox/projection degradation drill: NO-GO blocker, chaos drill report not attached. ClickHouse/Kafka outage drill is not an MVP blocker unless those systems are reintroduced.
- [ ] RPC outage or slow RPC drill: NO-GO blocker, chaos drill report not attached.
- [ ] Postgres failover drill: NO-GO blocker, failover drill report not attached.
- [ ] Postgres idempotency/lock fallback evidence: NO-GO blocker, low-cost MVP runtime does not deploy Redis, so durable Postgres idempotency and row-lock behavior must be verified instead.
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
- [x] Alert drill screenshots or links: PASS for staging drill, `docs/evidence/staging/gcp-alerts/20260425T103854Z-gcp-alerts-staging` validates GCP Monitoring-style payload to gateway-admin receiver to Lark. Production alert routing remains NO-GO until production dashboards and on-call are attached.
- [ ] Metrics endpoint access control: NO-GO blocker, proxy-layer `/metrics` allowlist and app-layer metrics token proof not attached.
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
- [ ] Backup policy: NO-GO blocker, production backup policy and fresh restore proof not attached. Backup restore evidence older than 72 hours is stale.
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
- Notes: Staging automation now has fresh smoke, contract, Lark, gateway full-chain, Gmail, GCP alert, core dogfood, withdrawal-review, backup restore, and light-load evidence. Production launch remains blocked by explicit P0 evidence gaps listed above, especially chaos/recovery, adversarial security, production config, dashboards/on-call, and sign-off evidence.
