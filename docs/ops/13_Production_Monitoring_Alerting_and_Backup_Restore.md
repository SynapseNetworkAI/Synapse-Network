# Production Monitoring, Alerting, and Backup Restore

- Status: canonical
- Code paths: `services/gateway/src/core/metrics.py`, `services/gateway-admin/src/core/metrics.py`, `infra/monitoring/`, `infra/docker/restore/`, `scripts/ops/lark_alert_relay.mjs`, `scripts/e2e/lark_alert_e2e.mjs`, `scripts/ci/lark_alert_e2e_evidence_check.mjs`, `scripts/drills/`, `scripts/ci/backup_restore_evidence_check.mjs`
- Verified with: `npm run ci:monitoring-alert-rules`, `npm run ci:lark-alert-e2e-evidence`, `npm run ci:backup-restore-evidence`, `npm run ci:docs`
- Last verified against code: 2026-04-21

## 1. Goal

Synapse production must be observable, alertable, and recoverable before launch.

The v1 rule is deliberately simple:

1. Gateway and gateway-admin expose internal-only Prometheus-compatible metrics.
2. Production/staging alerts are grouped by asset-safety severity.
3. Backup restore drills prove Postgres financial state can be restored and reconciled.
4. Analytics outbox and Postgres projections remain queryable after restore.
5. Evidence must be recent, digest-protected, and attached to Go/No-Go validation.

## 2. Metrics Endpoint Security

`/metrics` is sensitive because it exposes traffic volume, failure rates, and operational shape.

Production requires two layers:

1. Reverse proxy / ingress / ALB / Cloudflare blocks public `/metrics` and allows only Prometheus private source ranges.
2. Application layer requires `METRICS_BEARER_TOKEN` or `METRICS_BASIC_USERNAME` + `METRICS_BASIC_PASSWORD`.

Missing app-layer metrics credentials means `/metrics` returns `metrics_not_configured`.

Metrics must not expose:

1. raw wallet addresses
2. transaction hashes
3. signatures
4. JWTs, cookies, tokens, secrets, private keys
5. SQL strings or request bodies

The runtime metrics helper drops unsafe or high-cardinality label values and emits `METRIC_LABEL_REJECTED` in logs.

## 3. Alert Severity Model

P0 alerts protect assets and secrets:

1. ledger/vault unexplained delta
2. negative balance attempt
3. duplicate debit or duplicate credit
4. withdrawal ticket replay/tamper anomaly
5. ticket consumed after expired finalization
6. secret leak
7. unexpected signer or owner change

P1 alerts protect service availability:

1. Gateway 5xx rate
2. invoke success-rate degradation
3. DB pool, lock wait, or deadlock spike
4. Cloud SQL connections above 80% of the instance limit for five minutes
5. Gateway `too many connections` log matches
6. deposit confirm lag
7. long-lived pending or frozen funds
8. analytics outbox backlog or projection freshness lag
9. provider outage
10. gateway-admin approval failure
11. `ADMIN_ACCOUNT_LOCKED` log match from gateway-admin
12. `ADMIN_LOGIN_FAILURE` log matches above threshold in five minutes

For Cloud SQL connection pool alerts, the Lark card must include:

```text
Business scenario: Cloud SQL connection pool near exhaustion
Impact: Gateway finance/API requests may fail or timeout
Action: reduce Cloud Run max instances/concurrency or upgrade Cloud SQL tier
```

For admin login brute-force or MFA guessing alerts, the Lark card must include:

```text
Business scenario: Admin login brute-force or MFA guessing detected
Impact: Admin control plane account may be under credential stuffing or OTP guessing attack
Action: check admin_action_audit by emailHash, verify source IP/user agent, keep the account locked unless an owner approves unlock
```

P2 alerts protect operations and UX:

1. budget blocked spike
2. analytics degraded
3. large queue growth
4. provider slow-lane growth

## 4. Lark Alert Routing

Lark v1 is webhook-only. Do not use Lark OpenAPI, message update APIs, thread APIs, or an ACK database for MVP production.

Alertmanager is the only routing and fanout source of truth. The Lark Relay is a translator only:

1. `POST /lark/p0-war-room` sends to `Synapse-P0-资金战情室`.
2. `POST /lark/prod-alerts` sends to `Synapse-Prod-告警大厅`.
3. `POST /lark/staging-drill` sends to `Synapse-Staging-Drill-演练`.

The Relay must not inspect `severity` or `system` to choose a destination. If routing changes are needed, change `infra/monitoring/alertmanager/alertmanager.yml`, not Relay code.

Prometheus must provide an `env` label through external labels, for example `env=prod` or `env=staging`. Production P0 alerts route to the P0 room. Production P1/P2 alerts route to the production alert hall. Staging and drill alerts route to the staging drill group only.

Lark Relay runtime configuration is loaded from environment variables. Webhook URLs and robot signing secrets must come from the deployment secret store, not git-tracked files:

| Variable | Meaning |
| --- | --- |
| `LARK_ALERT_RELAY_PORT` | Local HTTP port for `scripts/ops/lark_alert_relay.mjs`. |
| `LARK_ALERT_RELAY_HOST` | Bind address for the Relay process, usually `0.0.0.0` inside containers. |
| `LARK_ALERT_RELAY_MAX_RETRIES` | Bounded retry count when a Lark webhook delivery fails. |
| `LARK_WEBHOOK_P0_WAR_ROOM` | Lark group robot webhook URL for `Synapse-P0-资金战情室`. |
| `LARK_SECRET_P0_WAR_ROOM` | Lark robot signing secret for the P0 war room webhook, if signature verification is enabled. |
| `LARK_WEBHOOK_PROD_ALERTS` | Lark group robot webhook URL for `Synapse-Prod-告警大厅`. |
| `LARK_SECRET_PROD_ALERTS` | Lark robot signing secret for the production alert hall webhook, if signature verification is enabled. |
| `LARK_WEBHOOK_STAGING_DRILL` | Lark group robot webhook URL for `Synapse-Staging-Drill-演练`. |
| `LARK_SECRET_STAGING_DRILL` | Lark robot signing secret for the staging drill webhook, if signature verification is enabled. |

If a Lark robot uses keyword-only verification, the keyword belongs in the rendered alert title or summary. Do not store a keyword in `LARK_SECRET_*` unless Lark explicitly provides it as a signing secret.

Lark cards must be compact and safe:

1. `status=firing` renders a red/orange fault card.
2. `status=resolved` renders a green recovery card.
3. P0/P1/P2 alerts should include `business_scenario`, `impact`, `trigger`, and `action` annotations so the Lark card explains what business path failed, who is affected, why it fired, and what the operator should check first.
4. Alertmanager batches are folded: show the first alert and summarize the remaining count.
5. Error excerpts are bounded by both line count and character count: last 5 lines and at most 1000 characters.
6. Whole card payloads above 24KB enter compact mode.
7. Relay performs only final-pass redaction; runtime metric helpers remain the primary high-cardinality and sensitive-label guard.

Silent lifecycle events such as `requirement_created` and `workflow_run_started` are digest-only. A separate runner heartbeat or stale-running metric must trigger `SynapseRunnerStale` when the workflow engine stops updating active work.

Lark real-delivery E2E evidence lives under:

```bash
docs/evidence/alerts/lark/<timestamp>-lark-e2e/
```

`npm run e2e:lark-alerts` sends real webhook probes to all three configured Lark groups. Every probe must include `[LARK_E2E_TEST][NO_ACTION_REQUIRED]` and `runId`, and must generate `report.json`, `report.md`, `environment-manifest.json`, and `sent-messages.json`. This E2E verifies webhook reachability, signing, firing/recovery cards, batch folding, truncation, and redaction. It must never write raw webhook URLs, signing secrets, request signatures, or authorization tokens to evidence.

The Lark E2E probes must also be business-readable. A successful probe card must make it clear whether the example is a Gateway invoke core-path failure, finance reconciliation anomaly, staging drill, or batch-folding test, and must include impact and recommended action text. A generic "delivery probe" without business context is not valid release evidence.

## 5. Drill Isolation

Synthetic drills must never pollute real finance reporting.

Required drill identity:

1. `tenant_id = drill_synthetic`
2. dedicated drill merchant/provider/consumer ids
3. dedicated staging drill wallet addresses
4. `is_drill = true` on drill-only alert metrics

Real finance reconciliation and admin analytics queries must exclude `tenant_id = drill_synthetic`.

Drill alerts must include:

1. `is_drill="true"`
2. `env="staging"`
3. `severity="drill"`

Alertmanager must route these to staging drill channels only. Drill alerts must never page production PagerDuty.

## 6. Backup Restore v1 Boundary

v1 backup restore is intentionally not a chain replay engine.

Postgres restore must verify:

1. schema is present
2. critical table row counts are available
3. critical checksums are available when configured
4. ledger/vault reconciliation reports `0.000000` unexplained delta

MVP v1 restore drill does not require ClickHouse restore. Analytics release
health is checked through Postgres outbox/projection freshness and admin
analytics smoke queries. ClickHouse/Kafka restore can return as a growth-stage
drill when those components become production dependencies.

Do not require Postgres and ClickHouse row-to-row equality in v1. ClickHouse is
not part of the MVP low-cost staging/prod runtime, and strict cross-store
equality would create false release blockers.

Do not run RPC chain event replay in v1 restore drill. Chain reconciliation belongs to a separate daily reconciliation job.

Redis and Kafka are not MVP money source-of-truth systems. They are not required
for v1 restore and are not used to reconstruct balances.

## 7. Evidence Contract

Backup restore evidence lives under:

```bash
docs/evidence/recovery/<timestamp>-backup-restore-drill/
```

Required files:

1. `report.md`
2. `report.json`
3. `backup-manifest.json`
4. `restore-validation.json`
5. `reconciliation-summary.json`
6. `environment-manifest.json`

`report.json` must include:

1. `generatedAt`
2. `environment`
3. `gitCommit`
4. `backupStartedAt`
5. `restoreFinishedAt`
6. `evidenceDigest`
7. `status`
8. `failed`

Evidence expires after 72 hours. Old evidence cannot be reused for release approval.

The digest is intentionally simple: read the core JSON files by fixed file-name order, `JSON.stringify` each parsed object, concatenate, and hash with SHA-256.

## 8. Commands

Validate static monitoring assets:

```bash
npm run ci:monitoring-alert-rules
```

Run the local Lark Relay:

```bash
LARK_WEBHOOK_P0_WAR_ROOM=... \
LARK_SECRET_P0_WAR_ROOM=... \
LARK_WEBHOOK_PROD_ALERTS=... \
LARK_SECRET_PROD_ALERTS=... \
LARK_WEBHOOK_STAGING_DRILL=... \
LARK_SECRET_STAGING_DRILL=... \
node scripts/ops/lark_alert_relay.mjs
```

Run real Lark delivery E2E after confirming all three groups allow test probes:

```bash
LARK_WEBHOOK_P0_WAR_ROOM=... \
LARK_SECRET_P0_WAR_ROOM=... \
LARK_WEBHOOK_PROD_ALERTS=... \
LARK_SECRET_PROD_ALERTS=... \
LARK_WEBHOOK_STAGING_DRILL=... \
LARK_SECRET_STAGING_DRILL=... \
npm run e2e:lark-alerts
```

Validate the latest Lark delivery evidence:

```bash
npm run ci:lark-alert-e2e-evidence
```

Run staging backup restore drill:

```bash
SYNAPSE_DRILL_ENV=staging \
SYNAPSE_DRILL_CONFIRM=I_UNDERSTAND_THIS_CHANGES_STAGING \
RESTORE_POSTGRES_DSN=postgresql://... \
RESTORE_CLICKHOUSE_URL=http://... \
npm run drill:backup-restore:staging
```

Validate latest restore evidence:

```bash
npm run ci:backup-restore-evidence
```

Use a specific evidence bundle:

```bash
SYNAPSE_BACKUP_RESTORE_EVIDENCE_DIR=docs/evidence/recovery/<bundle> \
npm run ci:backup-restore-evidence
```

## 9. Launch Rule

Production is **NO-GO** if:

1. `/metrics` is publicly reachable.
2. metrics credentials are not configured.
3. P0/P1 alert rules are missing.
4. drill alerts route to production PagerDuty.
5. Lark Relay points directly to production webhooks from git-tracked config instead of env secrets.
6. Alertmanager routing is duplicated in Relay code.
7. Lark real-delivery evidence is missing, failed, stale, or leaks webhook/secret values.
8. backup restore evidence is missing, failed, stale, or digest-invalid.
9. restored Postgres reconciliation has non-zero unexplained delta.
10. restored ClickHouse freshness exceeds the configured threshold.
