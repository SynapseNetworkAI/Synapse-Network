# Gateway Release Full-Chain E2E Evidence

- Status: `failed`
- Environment: `staging`
- Profile: `mvp-postgres`
- Generated at: `2026-05-12T15:43:57.816142+00:00`
- Git commit: `b6a0da70d90bca6256e3b6518a13e73b3929cc4c`
- Git dirty: `True`
- Evidence digest: `29edcbd6e0a6eec681bb3cbeba783dfaed3a7222482ee90da5375ba85a5fc3b1`
- Trace digest: `cc6fcab094bb60ed3cc350922454a0ad8d825d9d3f078ff72a2b86653394d2e0`
- Trace lines: `13`

## Pytest Summary

- Tests: `73`
- Failures: `13`
- Errors: `6`
- Skipped: `8`

## Expected vs Actual

| Stage | Metric | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| pytest | Skipped tests | 0 | 8 | FAIL |
| pytest | Collected tests | >=50 | 73 | PASS |
| contract | Contract manifest errors | 0 | 0 | PASS |
| analytics | Postgres outbox mode | postgres-outbox | postgres-outbox | PASS |
| gateway-fullchain | deposit | pass | test_deposit_full_pipeline=error | FAIL |
| gateway-fullchain | confirm | pass | test_deposit_confirm=failed | FAIL |
| gateway-fullchain | service_discovery | pass | test_get_quote_for_service=skipped | FAIL |
| gateway-fullchain | quote | pass | test_get_quote_for_service=skipped, test_01_quote_service=failed | FAIL |
| gateway-fullchain | invoke | pass | test_invocation_deducts_balance=skipped, test_02_invoke_service=failed | FAIL |
| gateway-fullchain | provider_credit | pass | test_invocation_deducts_balance=skipped | FAIL |
| gateway-fullchain | receipt | pass | test_invocation_receipt_reachable=skipped, test_03_get_invocation_receipt=failed | FAIL |
| gateway-fullchain | consumer_withdrawal | pass | 2 testcase(s) passed | PASS |
| gateway-fullchain | ledger_vault_reconciliation | pass | test_invocation_deducts_balance=skipped | FAIL |

## Failures

- pytest exited with 1
- pytest failures=13 errors=6
- pytest skipped=8
- pytest / Skipped tests expected 0 actual 8
- gateway-fullchain / deposit expected pass actual test_deposit_full_pipeline=error
- gateway-fullchain / confirm expected pass actual test_deposit_confirm=failed
- gateway-fullchain / service_discovery expected pass actual test_get_quote_for_service=skipped
- gateway-fullchain / quote expected pass actual test_get_quote_for_service=skipped, test_01_quote_service=failed
- gateway-fullchain / invoke expected pass actual test_invocation_deducts_balance=skipped, test_02_invoke_service=failed
- gateway-fullchain / provider_credit expected pass actual test_invocation_deducts_balance=skipped
- gateway-fullchain / receipt expected pass actual test_invocation_receipt_reachable=skipped, test_03_get_invocation_receipt=failed
- gateway-fullchain / ledger_vault_reconciliation expected pass actual test_invocation_deducts_balance=skipped

## Evidence Files

- `pytest-junit.xml`
- `trace.jsonl`
- `gateway-e2e.log`
- `environment-manifest.json`
- `contract-manifest.json`
- `analytics-clickhouse-summary.json`
- `reconciliation-summary.json`
- `job-execution-summary.json`
