# Recovery Evidence

- Status: canonical
- Code paths: `scripts/drills/backup_restore_staging.sh`, `scripts/drills/gcp_staging_backup_restore_drill.sh`, `scripts/ci/backup_restore_evidence_check.mjs`, `infra/docker/restore/docker-compose.restore.yml`
- Verified with: `npm run ci:backup-restore-evidence`
- Last verified against code: 2026-04-21

This directory stores reviewed backup/restore drill evidence that is safe to commit.

Do not commit production dumps, secrets, private keys, raw logs, cookies, or tokens.

Backup/restore evidence bundles must be generated under:

```bash
docs/evidence/recovery/<timestamp>-backup-restore-drill/
```

Each bundle must contain:

1. `report.md`
2. `report.json`
3. `backup-manifest.json`
4. `restore-validation.json`
5. `reconciliation-summary.json`
6. `environment-manifest.json`

Validate the latest bundle with:

```bash
npm run ci:backup-restore-evidence
```

For staging release evidence, use `scripts/drills/gcp_staging_backup_restore_drill.sh`
so the restore target is a temporary isolated Cloud SQL instance. The live
staging DSN must not be used as `RESTORE_POSTGRES_DSN`.

Evidence expires after 72 hours for release approval.
