# BUG-GOLIVE-03 - performance reliability gate lacked local smoke automation

## Reproduction

Review the production Go/No-Go performance section:

```bash
rg -n "Performance and Reliability Evidence|load test|chaos drill" docs/plans/production-go-live-security-verification
```

Before this fix, the plan correctly required load, chaos, rollback, and recovery evidence, but there was no local CI command that could repeatedly verify basic reliability guardrails such as provider health probe concurrency and slow-lane scheduling.

## Root Cause

Performance and reliability requirements existed only as release evidence checkboxes. The repository had no lightweight automation tier between ordinary unit tests and external staging load/chaos drills.

## Fix

Added:

1. `docs/ops/11_Performance_and_Reliability_Verification.md`
2. `scripts/ci/performance_reliability_checks.sh`
3. `npm run ci:performance-reliability`
4. gateway performance smoke tests for provider health probe concurrency and slow-lane scheduling
5. `ci:pr` integration so the smoke cannot be bypassed during normal pushes

## Verification

```bash
npm run ci:performance-reliability
```

Expected result:

```text
2 passed
```

## Residual Risk

This is local deterministic smoke coverage. It does not replace staging load reports, chaos drill evidence, rollback drill evidence, backup restore evidence, or production monitoring alert drills.
