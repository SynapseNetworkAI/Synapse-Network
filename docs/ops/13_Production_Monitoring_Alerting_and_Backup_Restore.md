# Production Monitoring, Alerting, and Backup Restore

- Status: canonical
- Code paths: `services/gateway/src/core/metrics.py`, `services/gateway-admin/src/core/metrics.py`, `infra/monitoring/`, `infra/docker/restore/`, `scripts/drills/`, `scripts/ci/backup_restore_evidence_check.mjs`
- Verified with: `npm run ci:monitoring-alert-rules`, `npm run ci:backup-restore-evidence`, `npm run ci:docs`
- Last verified against code: 2026-04-21

## 1. Goal

Synapse production must be observable, alertable, and recoverable before launch.

The v1 rule is deliberately simple:

1. Gateway and gateway-admin expose internal-only Prometheus-compatible metrics.
2. Production/staging alerts are grouped by asset-safety severity.
3. Backup restore drills prove Postgres financial state can be restored and reconciled.
4. ClickHouse restore proves analytics is queryable and fresh enough, not row-perfect with Postgres.
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
4. deposit confirm lag
5. long-lived pending or frozen funds
6. Kafka / ClickHouse lag
7. provider outage
8. gateway-admin approval failure

P2 alerts protect operations and UX:

1. admin login or MFA anomaly
2. budget blocked spike
3. analytics degraded
4. large queue growth
5. provider slow-lane growth

## 4. Drill Isolation

Synthetic drills must never pollute real finance reporting.

Required drill identity:

1. `tenant_id = drill_synthetic`
2. dedicated drill merchant/provider/consumer ids
3. dedicated staging drill wallet addresses
4. `is_drill = true` on drill-only alert metrics

Real finance reconciliation, admin analytics, and default ClickHouse dashboard queries must exclude `tenant_id = drill_synthetic`.

Drill alerts must include:

1. `is_drill="true"`
2. `env="staging"`
3. `severity="drill"`

Alertmanager must route these to staging drill channels only. Drill alerts must never page production PagerDuty.

## 5. Backup Restore v1 Boundary

v1 backup restore is intentionally not a chain replay engine.

Postgres restore must verify:

1. schema is present
2. critical table row counts are available
3. critical checksums are available when configured
4. ledger/vault reconciliation reports `0.000000` unexplained delta

ClickHouse restore must verify:

1. analytics schema exists
2. critical event count is above the expected minimum
3. latest freshness lag is within threshold, default `300s`
4. admin analytics smoke queries are queryable

Do not require Postgres and ClickHouse row-to-row equality. Their backup timestamps are not guaranteed to be identical, and strict equality creates false release blockers.

Do not run RPC chain event replay in v1 restore drill. Chain reconciliation belongs to a separate daily reconciliation job.

Redis and Kafka are not money source-of-truth systems. They can be health-checked, but they are not used to reconstruct balances.

## 6. Evidence Contract

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

## 7. Commands

Validate static monitoring assets:

```bash
npm run ci:monitoring-alert-rules
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

## 8. Launch Rule

Production is **NO-GO** if:

1. `/metrics` is publicly reachable.
2. metrics credentials are not configured.
3. P0/P1 alert rules are missing.
4. drill alerts route to production PagerDuty.
5. backup restore evidence is missing, failed, stale, or digest-invalid.
6. restored Postgres reconciliation has non-zero unexplained delta.
7. restored ClickHouse freshness exceeds the configured threshold.
