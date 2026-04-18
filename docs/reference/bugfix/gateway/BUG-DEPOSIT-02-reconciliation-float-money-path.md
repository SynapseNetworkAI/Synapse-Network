# BUG-DEPOSIT-02 — Deposit Reconciliation Float Money Path

**Status:** Fixed  
**Severity:** High  
**Component:** `services/gateway` — deposit indexer / reconciliation  
**Reported:** 2026-04-18  
**Code paths:** `services/gateway/src/services/platform/tasks/deposit_indexer/chain.py`, `services/gateway/src/services/platform/tasks/deposit_indexer/reconciliation.py`, `services/gateway/src/services/platform/tasks/deposit_indexer/processing.py`, `services/gateway/src/services/platform/tasks/deposit_indexer/runner.py`, `services/gateway/src/services/platform/tasks/deposit_indexer/shared.py`  
**Last verified against code:** 2026-04-18

---

## Summary

`gateway-runtime.log` was repeatedly emitting:

```text
deposit reconciliation check failed
TypeError: float is forbidden for money values
```

The runtime task was healthy enough to keep looping, but every reconciliation pass failed before
persisting an accurate vault-vs-ledger snapshot.

## Root Cause

`_amount_usdc_from_raw()` converted chain atomic units with Python `float`:

```text
round(float(amount_raw) / float(10**decimals), 6)
```

After the Money Contract hardening, `MoneyCodec.coerce_decimal()` correctly rejects `float` inputs.
The reconciliation task still called the legacy float conversion, so the stricter guard turned an
old precision bug into a visible runtime error.

## Fix

- Changed chain atomic-unit conversion to return `Decimal` through `MoneyCodec.from_atomic()`.
- Updated deposit event matching to compare `Decimal` amounts instead of float epsilon math.
- Serialized reconciliation runtime state, audit details, and log fields as canonical money strings.
- Kept analytics emission on the Decimal-safe path.

## Verification

Targeted regression:

```bash
cd services/gateway
PYTHONPATH=. .venv/bin/pytest tests/unit/test_deposit_indexer_money_unit.py -q
```

Completed verification:

```bash
cd services/gateway
PYTHONPATH=. .venv/bin/pytest tests/unit/test_deposit_indexer_money_unit.py tests/unit/test_deposit_indexer_runtime_state_unit.py -q
PYTHONPATH=. .venv/bin/pytest -q
bash scripts/ci/pr_checks.sh
```

Result:

- Targeted deposit indexer tests: 5 passed.
- Gateway tests: 322 passed, 86 skipped.
- Full PR gate: passed after the follow-up gateway-admin analytics fix.
