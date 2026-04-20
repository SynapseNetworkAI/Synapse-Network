# BUG-ADMIN-ANALYTICS-10K-DECIMAL-LOGGING

## Status

Fixed in local workspace.

## Summary

During the strict Admin Analytics 10k dogfood run, Gateway emitted many `invocation.complete` log records with `Decimal` values in structured extras. The JSON file formatter called `json.dumps()` without a serializer, which raised `TypeError: Object of type Decimal is not JSON serializable`.

This did not change ledger amounts, but it polluted runtime logs, invoked Python logging error handling repeatedly, and added avoidable overhead during the high-volume invoke path.

## Reproduction

1. Start Gateway with JSON file logging enabled.
2. Run `npm run e2e:admin-analytics-10k:fullchain` with strict Kafka/ClickHouse mode.
3. Inspect `services/gateway/logs/provider_api.log`.
4. Observe logging stack traces from `src/core/log_config.py` while handling `invocation.complete`.

## Root Cause

`JsonFormatter.format()` serialized the complete log payload with `json.dumps(payload, ensure_ascii=False)` and did not provide a `default` handler for `Decimal`.

The invoke path correctly uses `Decimal` for money values, but the log formatter was not Decimal-safe.

## Fix

- Added a JSON default serializer in `services/gateway/src/core/log_config.py`.
- `Decimal` values are serialized as canonical strings.
- `datetime` values are serialized with ISO format.
- Replaced the remaining `float(unit_price)` logging conversion in the invoke path with `str(unit_price)`.

## Verification

```bash
cd services/gateway
.venv/bin/python -m pytest tests/unit/test_logging_plan_unit.py::test_setup_logger_serializes_decimal_fields tests/unit/test_analytics_emitter_unit.py -q
```

Result:

```text
14 passed
```

The subsequent strict 10k run no longer produced `Object of type Decimal is not JSON serializable` logging errors.

## Residual Risk

Other non-JSON-native types in future log extras will still be stringified by the formatter. That is intentional for observability safety; business payloads and API schemas remain responsible for strict typed serialization.
