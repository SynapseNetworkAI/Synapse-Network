# Gateway Release Full-Chain E2E Evidence

- Status: `success`
- Environment: `staging`
- Profile: `mvp-postgres`
- Generated at: `2026-05-12T16:02:25.778292+00:00`
- Git commit: `dea6c41603d395005def38ccc5b6558d4d601bdf`
- Git dirty: `True`
- Evidence digest: `dba76758290ef23b1d70bc7385de8a7ba4ea3215f953c809cb4b8c6ed96e3466`
- Trace digest: `d42842cc414e72af69cc02a52a94c7fe4dd76a01daf0f244f1447223cb967ca6`
- Trace lines: `13`

## Pytest Summary

- Tests: `73`
- Failures: `0`
- Errors: `0`
- Skipped: `0`

## Expected vs Actual

| Stage | Metric | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| pytest | Skipped tests | 0 | 0 | PASS |
| pytest | Collected tests | >=50 | 73 | PASS |
| contract | Contract manifest errors | 0 | 0 | PASS |
| analytics | Postgres outbox mode | postgres-outbox | postgres-outbox | PASS |
| gateway-fullchain | deposit | pass | 1 testcase(s) passed | PASS |
| gateway-fullchain | confirm | pass | 2 testcase(s) passed | PASS |
| gateway-fullchain | service_discovery | pass | 1 testcase(s) passed | PASS |
| gateway-fullchain | quote | pass | 2 testcase(s) passed | PASS |
| gateway-fullchain | invoke | pass | 2 testcase(s) passed | PASS |
| gateway-fullchain | provider_credit | pass | 1 testcase(s) passed | PASS |
| gateway-fullchain | receipt | pass | 2 testcase(s) passed | PASS |
| gateway-fullchain | consumer_withdrawal | pass | 2 testcase(s) passed | PASS |
| gateway-fullchain | ledger_vault_reconciliation | pass | 2 testcase(s) passed | PASS |

## Failures

- none

## Evidence Files

- `pytest-junit.xml`
- `trace.jsonl`
- `gateway-e2e.log`
- `environment-manifest.json`
- `contract-manifest.json`
- `analytics-clickhouse-summary.json`
- `reconciliation-summary.json`
- `job-execution-summary.json`
