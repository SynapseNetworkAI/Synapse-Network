# Gateway Release Full-Chain E2E Evidence

- Status: `success`
- Environment: `staging`
- Profile: `mvp-postgres`
- Generated at: `2026-04-26T02:10:11.145315+00:00`
- Git commit: `98e95ab78a08ed95edd52ae4a091091d0742d707`
- Git dirty: `True`
- Evidence digest: `e255ecb60b1b2bf060b5808e66accbd0568b2369737745d58d2713c0ef2262de`
- Trace digest: `71de781c74d88e1649e93dfd96b502fa712002ddac48423fbb9a36cd4ddf336d`
- Trace lines: `13`

## Pytest Summary

- Tests: `72`
- Failures: `0`
- Errors: `0`
- Skipped: `0`

## Expected vs Actual

| Stage | Metric | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| pytest | Skipped tests | 0 | 0 | PASS |
| pytest | Collected tests | >=50 | 72 | PASS |
| contract | Contract manifest errors | 0 | 0 | PASS |
| analytics | Postgres outbox mode | postgres-outbox | postgres-outbox | PASS |
| gateway-fullchain | deposit | pass | 1 testcase(s) passed | PASS |
| gateway-fullchain | confirm | pass | 2 testcase(s) passed | PASS |
| gateway-fullchain | service_discovery | pass | 3 testcase(s) passed | PASS |
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
