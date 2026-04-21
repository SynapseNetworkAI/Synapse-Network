# Agent Code Quality Guardrails

- Status: canonical
- Code paths: `semgrep/`, `mypy-finance.ini`, `ruff.toml`, `.jscpd.json`, `scripts/ci/run_guardrail_tool.sh`, `scripts/ci/code_quality_architecture_scan.*`, `scripts/ci/finance_approval_safety_scan.sh`, `scripts/ci/finance_mypy_scan.sh`
- Verified with: `npm run ci:agent-guardrails`, `npm run ci:architecture-quality`, `npm run ci:financial-security`
- Last verified against code: 2026-04-20

This document defines the physical gates that prevent Agent-generated code from becoming unsafe, unmaintainable, or copy-pasted across financial flows.

## Invariants

1. Passing functional tests is not enough. New code must also pass security, complexity, and duplication gates.
2. Agent must not solve failing tests by adding spaghetti code, deep nesting, or copied business logic.
3. Finance-sensitive paths are strict by default: money, ledger, refund, withdrawal, approval, review, complete, reconciliation, and audit.
4. Existing hotspots are tracked in `docs/plans/refactor-watch.md`. Touching a hotspot requires either refactoring it or proving it did not worsen.
5. Copy-paste between consumer/provider/refund/withdraw state machines is forbidden. Extract shared service, helper, or state-machine logic and keep role policy at the caller.

## Gates

### Tool Execution

Python guardrail tools run through `scripts/ci/run_guardrail_tool.sh`.

1. Prefer `uvx --from <package> <tool>` when `uvx` is available.
2. Fall back to a tool already installed on `PATH`.
3. If neither is available, fail closed with an `Agent fix:` install prompt.

Do not add a repo-local guardrail `.venv`. The guardrail toolchain must stay isolated from service virtual environments.

### Financial Security Semgrep + Mypy

Command: `npm run ci:financial-security`

This gate runs Semgrep rules for:

1. explicit money float and unsafe Decimal construction
2. direct balance bucket mutation
3. unsafe approval schema validation
4. sensitive logging
5. raw SQL string construction
6. unsafe rounding
7. hardcoded secrets
8. external IO inside DB transactions
9. unsafe token/secret comparisons
10. sensitive error responses
11. non-crypto random usage for security identifiers

Semgrep rules should prefer AST/semantic `pattern` matching over `pattern-regex`. Regex is reserved for secret-like literals and token formats where text matching is the right tool.

This gate also runs a finance-only `mypy` profile to catch implicit type pollution that Semgrep OSS cannot reliably trace, such as a float literal flowing into Decimal money helpers. The `mypy` gate starts with changed finance-core files; full finance typing is a separate hardening phase.

Missing Semgrep or mypy is a failure, not a skip. Install `uv` once and the runner can execute both through `uvx`.

### Architecture Quality

Command: `npm run ci:architecture-quality`

This gate runs:

1. Ruff for Python lint, bug, security, and complexity rules.
2. Radon for cyclomatic complexity and maintainability index.
3. JSCPD for cross-language copy/paste detection.
4. Repo-local finance shape scan for changed finance-sensitive Python functions.

Phase 1 checks changed files plus finance-sensitive paths. This avoids turning historical debt into a full repository stop-the-world event while still blocking new debt. Radon/Ruff run through the same `uvx`-first runner.

### Agent Guardrails

Command: `npm run ci:agent-guardrails`

This combines financial security, architecture quality, local runtime guard, and E2E script model-drift scan.

## Failure Output Contract

Every gate must produce Agent-friendly output:

1. file and line when available
2. invariant id
3. why it is dangerous
4. direct repair instruction

Example:

```text
FATAL ARCH-COMPLEXITY-001: services/gateway/src/services/provider/foo.py:88
Why dangerous: function has 145 effective lines; Agent is piling state-machine logic into one function.
Agent fix: extract validation, state transition, persistence, and audit writing into smaller named functions.
```

## Rollout

Phase 1:

1. Changed-file gate only.
2. Strict finance-sensitive path checks.
3. Historical hotspots remain documented in `docs/plans/refactor-watch.md`.
4. Service-level gates must include each app's fast unit suite: `ci:admin-front` runs Vitest in addition to lint/build, and `ci:admin-gateway` runs the full gateway-admin pytest suite.

Phase 2:

1. Reduce or baseline the top five hotspots.
2. Expand Radon/Ruff to more gateway and gateway-admin paths.

Phase 3:

1. Release PRs attach architecture-quality evidence.
2. Heavy funds E2E evidence remains separate and mandatory for approval/withdrawal changes.

## Deadlock Boundary Rule

Finance code may use either standard retry boundary:

1. Function boundary: `@retry_on_deadlock(...)`
2. Block boundary: `with transaction_with_retry(...):`

Do not catch `DeadlockDetected` inside an already-open transaction and then continue issuing SQL. PostgreSQL aborts the transaction after SQLSTATE `40P01`; retrying one statement inside that aborted transaction is unsafe. Move the retry outside the full transaction unit.

## Optional Agent Prompt Extraction

`node scripts/ci/extract_agent_fix_prompts.mjs <log-file>` extracts every `Agent fix:` line from guardrail logs and turns them into a compact repair prompt. This is for human-supervised Agent repair loops only; CI must not automatically apply patches to finance code.

## Incremental Coverage Gate

Command: `npm run ci:diff-coverage`

This gate enforces "new code must be tested, historical debt is paid down incrementally."

Coverage input format is standardized on Cobertura XML:

1. Python services produce `coverage.xml` through `pytest-cov`.
2. `services/admin-front` produces `coverage/cobertura-coverage.xml` through Vitest `coverage-v8`.
3. `services/user-front` produces `coverage/cobertura-coverage.xml` through Vitest `coverage-v8`.

The gate is segmented because finance code and ordinary UI code do not carry the same risk:

1. Python finance-sensitive changed lines: `90%`.
2. Python ordinary backend changed lines: `80%`.
3. Frontend high-risk UI changed lines: `80%`.
4. Frontend ordinary UI changed lines: `70%`.

Each segment checks whether matching files changed before invoking `diff-cover`. Empty segments skip instead of failing, so docs-only changes and unrelated UI changes do not get punished by finance coverage rules.

Tests must verify behavior, not merely execute code:

1. Python tests need `assert`, `pytest.raises(...)`, `mock.assert_*`, or a semantic helper whose name starts with `assert_`, `expect_`, or `verify_`.
2. TS/JS tests need `expect(...)` or a semantic helper whose name starts with `assert`, `expect`, or `verify`.
3. Helper names are the semantic contract; there is no per-helper allowlist to maintain.

Coverage escape hatches are controlled:

1. New `# pragma: no cover` or `istanbul ignore *` markers must include a reason.
2. Finance-sensitive coverage ignores must also include `human-review-required` and an evidence id/path.
3. New `.skip(...)`, `it.skip`, `test.skip`, or `describe.skip` fails closed.

Diff-based gates require the base branch history. CI must check out the repository with full history, or at least fetch the base branch before running the gate.

## Agent Repair Playbook

When a gate fails:

1. Do not suppress the rule unless the rule is objectively wrong.
2. Prefer extracting named functions/classes over adding comments to justify complexity.
3. Prefer parameterized SQL over escaping.
4. Prefer redaction helpers over logging raw values.
5. Prefer shared state-machine helpers over copying consumer/provider code.
6. Re-run the narrow failed gate before running `ci:pr`.
