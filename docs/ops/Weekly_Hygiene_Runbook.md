# Weekly Hygiene Runbook

- Status: canonical
- Code paths: `.github/workflows/weekly-hygiene.yml`, `scripts/ops/weekly_hygiene.mjs`, `scripts/ci/weekly_hygiene_evidence_check.mjs`, `package.json`
- Verified with: `npm run weekly:hygiene -- --dry-run`, `npm run ci:weekly-hygiene-evidence`
- Last verified against code: 2026-05-13

## Purpose

Weekly hygiene is the Sunday safety harness for repository entropy. It does not
replace PR CI, release evidence, or finance E2E. Its job is to surface stale
artifacts, stale evidence, stale PRs, documentation drift, and safety-gate
failures before they become normal background noise.

The harness follows the Harness Engineering baseline:

1. The repository is the system of record.
2. Rules must be executable, not only prose.
3. Cleanup must be continuous and allowlist-based.
4. Docs, code, and validation must move together.

## Schedule and Authority

GitHub Actions runs the workflow every Sunday at 02:00 Malaysia Time:

```yaml
schedule:
  - cron: "0 18 * * 6"
```

GitHub Actions cron is evaluated in UTC, so Saturday 18:00 UTC is Sunday 02:00
MYT.

Default authority is **Report + Issue**:

1. Generate `output/weekly-hygiene/<timestamp>/report.json`.
2. Generate `report.md` and `issue.md`.
3. Upload the bundle as a workflow artifact with 30-day retention.
4. Create or update a GitHub issue only when the report status is
   `attention_required`.

The harness must not:

1. Delete tracked source files, docs, or `docs/evidence/**`.
2. Mutate staging or production databases.
3. Close PRs, delete remote branches, or open implementation PRs.
4. Store raw DSNs, tokens, private keys, full emails, or 64-byte hex values in
   evidence.

## What It Reviews

The weekly harness runs the existing executable constraints instead of creating
a parallel quality system:

1. Code hygiene: `ci:quality-budget`, `ci:architecture-quality`,
   `ci:format-check`, `ci:diff-coverage`.
2. Docs and workflow hygiene: `ci:docs`.
3. Finance and state safety: `ci:state-idempotency-safety`,
   `ci:finance-approval-safety`, `ci:created-at-indexes`.
4. Evidence freshness: withdrawal idempotency, Admin regression, User-front
   deposit balance, Admin pagination sorting, and backup/restore evidence
   checkers.
5. Repository garbage candidates: ignored/generated paths such as `output/`,
   coverage files, and local Next.js build caches.
6. GitHub hygiene: stale remote branches and open PRs that are old or conflicted.

## Cleanup Rules

Cleanup is allowlist-based. Generated local artifacts may be reported as cleanup
candidates, but tracked files are always report-only.

`docs/evidence/**` is never automatically deleted by weekly hygiene. Old tracked
evidence can be reported for human review, because release evidence is often part
of the audit trail.

Database cleanup is also never automatic. Local E2E data cleanup must use the
specific local runbooks and confirmation flags for that data family. Staging and
production cleanup require a separate operator-approved plan.

## Commands

Local dry run:

```bash
npm run weekly:hygiene -- --dry-run
npm run ci:weekly-hygiene-evidence
```

Full local run:

```bash
npm run weekly:hygiene
npm run ci:weekly-hygiene-evidence
```

Use `WEEKLY_HYGIENE_EVIDENCE_DIR=<path>` to validate a specific evidence bundle.

## Failure Handling

Individual hygiene gates failing does not stop report generation. The report
records failed checks, cleanup candidates, and stale GitHub items, then requests
a GitHub issue. The evidence checker fails only when the report bundle itself is
invalid, stale, incomplete, unsafe, or missing required checks.
