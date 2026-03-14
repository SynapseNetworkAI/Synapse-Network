# Backend Unit Testing Guide (Seller API)

This guide defines how backend tests are designed, organized, and executed for maintainability, extensibility, and regression safety.

## 1. Goals

1. Keep docs, code, and tests consistent for every backend behavior change.
2. Make refactor-safe test suites with clear business-intent naming.
3. Provide a fast path for unit checks and a separate path for pressure tests.

## 2. Test Directory Design

Root test folder:

```text
python_sdk/seller_api/tests/
  conftest.py
  unit/
    services/
      test_registry_service_unit.py
  integration/
    (reserved for API + storage flow tests)
  performance/
    test_forwarding_pressure.py
```

Design rules:
1. `unit/`: pure behavior tests for a module/function with minimal external dependencies.
2. `integration/`: route + service + storage contract tests.
3. `performance/`: pressure and throughput smoke tests for critical chains.
4. Keep old legacy tests runnable during migration; move gradually, do not break CI.

## 3. Naming and Scope Rules

1. Use business-intent names, not implementation details.
2. Include success and failure branch assertions.
3. One file targets one bounded context (e.g., registry normalization, forwarding path).

Examples:
1. `test_register_service_normalizes_cluster_and_health_path`
2. `test_normalize_service_payload_requires_invoke_targets`
3. `test_call_upstream_pressure_smoke`

## 4. Shared Fixtures

`tests/conftest.py` provides reusable fixtures:
1. Source-path bootstrapping for seller API imports.
2. `temp_json_storage` for isolated local storage tests.

## 5. Key Unit Test Coverage Baseline

At minimum, cover these areas:
1. Service registration normalization and strict schema validation.
2. Credential and idempotency rules for financial write paths.
3. Forwarding target selection and upstream error handling.
4. Storage normalization and serialization contracts.

## 6. Pressure Test Strategy for Critical Chains

Critical chain for this phase:
1. Forwarding service upstream call path (`_call_upstream`).

Pressure test profile:
1. Use mocked upstream client to remove external network noise.
2. Run high-concurrency burst (`1000` calls in one gather batch).
3. Assert correctness and enforce a smoke latency threshold.

Execution:

```bash
cd python_sdk/seller_api
RUN_PERF_TESTS=1 python -m pytest -q tests/performance -m performance
```

By default, pressure tests are skipped unless `RUN_PERF_TESTS=1`.

## 7. Command Reference

Unit tests only:

```bash
cd python_sdk/seller_api
python -m pytest -q tests/unit
```

All non-performance tests:

```bash
cd python_sdk/seller_api
python -m pytest -q -m "not performance"
```

Performance tests only:

```bash
cd python_sdk/seller_api
RUN_PERF_TESTS=1 python -m pytest -q tests/performance -m performance
```

## 8. Change Management Protocol

For every backend behavior change:
1. Update tests in the same commit.
2. Update docs if external behavior changed.
3. Run the relevant test subset before commit.
4. Keep doc/code/test semantics aligned.

If one side (doc/code/test) is missing, the change is incomplete.

## 9. E2E: Buyer -> serviceId -> Gateway Billing Validation

This section covers the exact scenario:
1. Buyer calls gateway with `serviceId`.
2. Gateway charges correctly.
3. Concurrency does not overspend balance.
4. Balance exhausted blocks calls but does not auto-inactivate credential.

### 9.1 Frameworks Used

1. `pytest`: test orchestration.
2. `fastapi.testclient.TestClient`: real route-level e2e calls.
3. `pytest monkeypatch`: stable auth/upstream isolation for deterministic local e2e.
4. `concurrent.futures.ThreadPoolExecutor`: local concurrency pressure on `/api/v1/gateway/generate`.
5. `TemporaryDirectory`: isolated runtime storage per test case.

### 9.2 Test Data Preparation Strategy

Prefer automated fixture setup over manual preloaded data.

Automated setup in each e2e case:
1. Start app with isolated `data_dir` and `runtime_storage_dir`.
2. Patch owner auth dependency to deterministic local owner identity.
3. Register service via `/api/v1/services` (strict `invoke.targets` + `healthCheck.path`).
4. Issue buyer credential via `/api/v1/credentials/buyer/issue`.
5. Seed ledger (`balance_ledger`) programmatically for deterministic balances.
6. Mock upstream call path to avoid external network instability.

### 9.3 E2E Test File

Implemented file:
1. `python_sdk/seller_api/tests/integration/test_gateway_generate_e2e.py`

Covered cases:
1. `test_e2e_gateway_charge_by_service_id`
  - Verifies one successful `/api/v1/gateway/generate` call decrements buyer, increments seller/platform by expected split.
2. `test_e2e_gateway_concurrency_no_overspend`
  - Runs concurrent requests and asserts successful call count never exceeds affordable balance.
  - Asserts no negative balance and ledger split remains consistent.
3. `test_e2e_balance_exhausted_does_not_inactivate_credential`
  - Verifies insufficient balance returns `INSUFFICIENT_BALANCE`.
  - Verifies credential remains active.
  - Verifies top-up enables same credential to succeed again.
4. `test_e2e_discover_returns_platform_url_and_gateway_charges`
  - Verifies `discover` returns platform gateway URL (not seller registered upstream URL).
  - Verifies Buyer can call discovered platform URL and still complete forwarding + billing.

### 9.4 Execution Commands

Run integration e2e only:

```bash
cd python_sdk/seller_api
python -m pytest -q tests/integration/test_gateway_generate_e2e.py
```

Run unit + integration regression (exclude performance):

```bash
cd python_sdk/seller_api
python -m pytest -q tests/unit tests/integration -m "not performance"
```

### 9.5 Recorded Test Results (Current Baseline)

Executed in local isolated env:
1. Unit + existing regression + new integration (non-performance): `14 passed`
2. Performance smoke: `1 passed`
3. New gateway e2e integration subset: `4 passed`

Result interpretation:
1. Gateway billing path is correct for serviceId-based invocation.
2. Concurrency path preserves balance safety (no overspend).
3. Balance exhaustion blocks billing requests but does not deactivate credential record.
4. Discovery payload now exposes only platform invoke URL while preserving successful charge-forward flow.

### 9.6 Which is Better: Manual Data vs Automation?

Recommended: **Automation-first**.

Reason:
1. Repeatable and CI-friendly.
2. Refactor-safe with deterministic setup/teardown.
3. Easier root-cause when regression appears.
4. Better coverage for concurrency and edge conditions than manual verification.

Use manual only for exploratory debugging after automated baseline is green.
