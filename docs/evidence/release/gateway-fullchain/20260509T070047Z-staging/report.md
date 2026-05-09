# Gateway Release Full-Chain E2E Evidence

- Status: `failed`
- Environment: `staging`
- Profile: `mvp-postgres`
- Generated at: `2026-05-09T07:01:15.760566+00:00`
- Git commit: `63bd026dda3382051fe661dfeed55e1adaf60c98`
- Git dirty: `True`
- Evidence digest: `9de85704e79b9c5f45871a3a2cf06dfd2777f539abe985f5088a32f275fe5684`
- Trace digest: `70957883f1f750ed7d42be2d0c2ce600752155acd6ea1d513d0aac34e008ac9d`
- Trace lines: `13`

## Pytest Summary

- Tests: `73`
- Failures: `6`
- Errors: `36`
- Skipped: `4`

## Expected vs Actual

| Stage | Metric | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| pytest | Skipped tests | 0 | 4 | FAIL |
| pytest | Collected tests | >=50 | 73 | PASS |
| contract | Contract manifest errors | 0 | 1 | FAIL |
| analytics | Postgres outbox mode | postgres-outbox | postgres-outbox | PASS |
| gateway-fullchain | deposit | pass | test_deposit_full_pipeline=error | FAIL |
| gateway-fullchain | confirm | pass | test_deposit_confirm=error, test_balance_reflects_deposit=error | FAIL |
| gateway-fullchain | service_discovery | pass | test_get_quote_for_service=error | FAIL |
| gateway-fullchain | quote | pass | test_get_quote_for_service=error, test_01_quote_service=failed | FAIL |
| gateway-fullchain | invoke | pass | test_invocation_deducts_balance=error, test_02_invoke_service=failed | FAIL |
| gateway-fullchain | provider_credit | pass | test_invocation_deducts_balance=error | FAIL |
| gateway-fullchain | receipt | pass | test_invocation_receipt_reachable=skipped, test_03_get_invocation_receipt=failed | FAIL |
| gateway-fullchain | consumer_withdrawal | pass | test_consumer_withdraw_decreases_available_balance=error, test_consumer_withdraw_record_has_correct_amount_and_status=error | FAIL |
| gateway-fullchain | ledger_vault_reconciliation | pass | test_invocation_deducts_balance=error, test_consumer_withdraw_reduces_total_spendable_capacity=error | FAIL |

## Failures

- pytest exited with 1
- pytest failures=6 errors=36
- pytest skipped=4
- pytest / Skipped tests expected 0 actual 4
- contract / Contract manifest errors expected 0 actual 1
- gateway-fullchain / deposit expected pass actual test_deposit_full_pipeline=error
- gateway-fullchain / confirm expected pass actual test_deposit_confirm=error, test_balance_reflects_deposit=error
- gateway-fullchain / service_discovery expected pass actual test_get_quote_for_service=error
- gateway-fullchain / quote expected pass actual test_get_quote_for_service=error, test_01_quote_service=failed
- gateway-fullchain / invoke expected pass actual test_invocation_deducts_balance=error, test_02_invoke_service=failed
- gateway-fullchain / provider_credit expected pass actual test_invocation_deducts_balance=error
- gateway-fullchain / receipt expected pass actual test_invocation_receipt_reachable=skipped, test_03_get_invocation_receipt=failed
- gateway-fullchain / consumer_withdrawal expected pass actual test_consumer_withdraw_decreases_available_balance=error, test_consumer_withdraw_record_has_correct_amount_and_status=error
- gateway-fullchain / ledger_vault_reconciliation expected pass actual test_invocation_deducts_balance=error, test_consumer_withdraw_reduces_total_spendable_capacity=error

## Evidence Files

- `pytest-junit.xml`
- `trace.jsonl`
- `gateway-e2e.log`
- `environment-manifest.json`
- `contract-manifest.json`
- `analytics-clickhouse-summary.json`
- `reconciliation-summary.json`
- `job-execution-summary.json`
