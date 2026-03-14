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
