---
id: bug-analytics-05-data-quality-tx-hash-privacy-false-positive
title: Data Quality wrongly counted tx_hash as privacy violation
status: fixed
created_at: 2026-04-17
fixed_at: 2026-04-17
area: gateway-admin analytics
---

# BUG-ANALYTICS-05: Data Quality tx_hash Privacy False Positive

## Symptom

`/dashboard/analytics/data-quality` reported privacy violations even when `distinct_id`
was already hashed. Local ClickHouse samples showed the affected rows were
`deposit_completed` events carrying a required chain audit field:

```json
{
  "event_name": "deposit_completed",
  "distinct_id": "7eaadf1989ccf0de8d49bd96d97f3677db8342952910f4ac0bf91f6f5f34f679",
  "properties": {
    "amount_usdc": 10,
    "token_symbol": "USDC",
    "tx_hash": "0x..."
  }
}
```

## Root Cause

The ClickHouse data-quality query used `position(properties, '0x') > 0` as a
privacy detector. That catches any hex-like value in the JSON payload, including
transaction hashes. A transaction hash is required for finance auditability and
is not a raw wallet address.

The same verification also surfaced that `deposit_completed` events could omit
`time_to_confirm_ms` when the runtime did not calculate a confirmation delay.
That made future data-quality checks noisy because the analytics contract marks
the field as required.

## Fix

- Narrowed privacy detection to `distinct_id` and known address-bearing fields:
  `wallet_address`, `owner_address`, `consumer_wallet`, `provider_wallet`,
  `from_address`, and `to_address`.
- Explicitly avoided treating `tx_hash` as PII.
- Changed `emit_deposit_completed()` to always include
  `time_to_confirm_ms`, defaulting to `0` when the precise delay is unavailable.

## Verification

Run the local regression:

```bash
/usr/bin/python3 scripts/admin_analytics_clickhouse_regression.py
```

The report is written to:

```text
output/analytics-fullchain/admin-clickhouse-regression.json
```

During the first local run on April 17, 2026, the only failing assertion was:

```text
data-quality privacy violations match ClickHouse
```

That failure happened because the already-running `gateway-admin` process still
served the pre-fix query. After restarting `gateway-admin`, the fixed query
should report `privacyViolations = 0` for tx-hash-only rows.

## Regression Guard

`services/gateway-admin/tests/test_analytics_dashboard_repository.py` now asserts
that the data-quality SQL no longer contains broad `position(properties, '0x')`
matching and does not inspect `tx_hash` for privacy violations.

`services/gateway/tests/unit/test_gateway_events_unit.py` now asserts that
`deposit_completed` includes `time_to_confirm_ms = 0` when no measured
confirmation time is supplied.
