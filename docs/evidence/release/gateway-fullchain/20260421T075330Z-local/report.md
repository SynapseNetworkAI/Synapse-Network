# Gateway Release Full-Chain E2E Evidence

- Status: `success`
- Environment: `local`
- Generated at: `2026-04-21T07:54:37.821946+00:00`
- Git commit: `f706294161bec1c90651b8cd4bc20015fbc5dbb0`
- Git dirty: `True`
- Evidence digest: `5da61409cb57bea815a9e02f0af6b82e2b8e4d5e669cc7793ca65da1f853512b`

## Pytest Summary

- Tests: `78`
- Failures: `0`
- Errors: `0`
- Skipped: `0`

## Expected vs Actual

| Stage | Metric | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| pytest | Skipped tests | 0 | 0 | PASS |
| pytest | Collected tests | >=78 | 78 | PASS |
| analytics | ClickHouse events | >0 | 42242 | PASS |
| contract | Contract manifest errors | 0 | 0 | PASS |
| gateway-fullchain | deposit | pass | 1 testcase(s) passed | PASS |
| gateway-fullchain | confirm | pass | 2 testcase(s) passed | PASS |
| gateway-fullchain | service_discovery | pass | 3 testcase(s) passed | PASS |
| gateway-fullchain | quote | pass | 2 testcase(s) passed | PASS |
| gateway-fullchain | invoke | pass | 2 testcase(s) passed | PASS |
| gateway-fullchain | provider_credit | pass | 1 testcase(s) passed | PASS |
| gateway-fullchain | receipt | pass | 2 testcase(s) passed | PASS |
| gateway-fullchain | consumer_withdrawal | pass | 2 testcase(s) passed | PASS |
| gateway-fullchain | analytics_kafka_clickhouse | pass | 2 testcase(s) passed | PASS |
| gateway-fullchain | ledger_vault_reconciliation | pass | 2 testcase(s) passed | PASS |

## Failures

- none

## Evidence Files

- `pytest-junit.xml`
- `gateway-e2e.log`
- `environment-manifest.json`
- `contract-manifest.json`
- `analytics-clickhouse-summary.json`
- `reconciliation-summary.json`
