---
created_at: 2026-04-18
updated_at: 2026-04-18
doc_status: active
---

# Staging Verification Report

## Run Summary

- Environment: Staging preflight from local workspace
- Source branch: `main`
- Source commit: `58dd322e`
- Run time: `2026-04-18 20:07:10 +08`
- Release decision: `NO-GO for production`
- Staging automation result: `PASS`
- Plan status: `BLOCKED_NO_GO`

The repository-local and staging-preflight gates that can be executed from this workspace passed. Production launch is still blocked because several P0 gates require external evidence that is not present in the repository: third-party audit closure, production multisig/signer proof, fork contract tests, production dry-run evidence, real-chain small-value rehearsal, load/chaos/restore drills, alert drills, and four-owner sign-off.

## Automated Evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Docs gate | PASS | `npm run ci:docs` -> documentation validation passed |
| Plan structure | PASS | `amem plan-check .` -> Overall OK |
| Money scan | PASS | `bash scripts/ci/security_money_scan.sh` -> money-sensitive float scan passed |
| TS money scan | PASS | `bash scripts/ci/security_money_ts_scan.sh` -> money-sensitive TypeScript scan passed |
| Secret scan | PASS | `bash scripts/ci/security_secret_scan.sh` -> secret scan passed |
| Release Go/No-Go state check | PASS | `npm run ci:release-go-no-go` -> staging automation evidence recorded, 60 explicit production blockers remain |
| PR gate | PASS | `npm run ci:pr` completed successfully |
| User frontend | PASS | `next lint`, `vitest run` -> 33 files / 158 tests passed, `next build` succeeded |
| Admin frontend | PASS | `next lint`, `next build` succeeded |
| Gateway | PASS | `pytest` -> 322 passed, 86 skipped, 1 warning |
| Gateway-admin | PASS | `pytest` -> 94 passed |
| Provider service | PASS | `pytest` -> 167 passed |
| Contracts gate | PASS | `npm run ci:contracts` -> 7 Hardhat security invariant tests passed |
| Performance/reliability smoke | PASS | `npm run ci:performance-reliability` -> provider health concurrency and slow-lane smoke passed |
| Local reliability suite | PASS | `npm run perf:local-reliability-suite` -> automation, scenario JSON, shell syntax, docs/release gates, staging confirmation guards, gateway health, and admin-front login checks passed; report at `docs/evidence/performance/20260418T130340Z-local-reliability-suite/report.md` |
| SDK Python | SKIPPED | `ci:pr` skipped because `sdk/python` manifest is not present |

## Bugfix Findings

Six fixable release-gate automation gaps were found and fixed during staging verification.

| Bug | Status | Verification |
| --- | --- | --- |
| `docs/reference/bugfix/scripts/BUG-GOLIVE-01-release-go-no-go-backtick-pattern.md` | FIXED | `npm run ci:release-go-no-go` passes |
| `docs/reference/bugfix/scripts/BUG-GOLIVE-02-contracts-gate-compile-only.md` | FIXED | `npm run ci:contracts` passes with 7 Hardhat tests |
| `docs/reference/bugfix/scripts/BUG-GOLIVE-03-performance-reliability-smoke-missing.md` | FIXED | `npm run ci:performance-reliability` passes |
| `docs/reference/bugfix/scripts/BUG-GOLIVE-04-performance-evidence-readme-metadata.md` | FIXED | `npm run ci:docs` passes |
| `docs/reference/bugfix/scripts/BUG-GOLIVE-05-local-perf-runner-unpaced-false-pass.md` | FIXED | `npm run perf:local-reliability-suite` includes `perf:local-smoke`; latest local smoke passed with pacing and failure thresholds |
| `docs/reference/bugfix/scripts/BUG-GOLIVE-06-reliability-suite-orchestration-missing.md` | FIXED | `npm run perf:local-reliability-suite` passes local automation and staging guard checks |

All other remaining gaps are release-evidence blockers, not implementation defects observed by the executed gates.

## Production NO-GO Blockers

| Blocker | Reason |
| --- | --- |
| Third-party contract audit evidence missing | Internal checks cannot replace external audit closure for production custody. |
| Fork test evidence missing | Production-like chain behavior has not been verified from this evidence bundle. |
| Deployment dry-run and ABI/bytecode evidence missing | Release manifest and deployed artifact identity are not attached. |
| Production multisig/signer proof missing | Production owner/signer custody cannot be verified from local CI. |
| Small-value real-chain rehearsal missing | Deposit, invoke-linked settlement, withdrawals, and fee withdrawal have no production/staging tx evidence attached. |
| Ledger/vault reconciliation report missing | Automated tests passed, but no release reconciliation report is attached. |
| Backup restore and chain-log replay drill missing | Recovery capability is not proven. |
| Load, chaos, and rollback drill evidence missing | Reliability under production-like failure modes is not proven. |
| Monitoring and alert drill screenshots missing | Detection and on-call routing are not proven. |
| Four-owner sign-off missing | Engineering, security, finance/ledger, and operations approval is required before production launch. |

## Final Decision

Staging automation passed, but production launch remains **NO-GO** with 60 explicit external P0 evidence gaps.

The next release owner must attach the missing production evidence in `validation.md` and rerun the applicable gates before requesting launch approval.
