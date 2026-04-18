# BUG-GOLIVE-06 - performance reliability evidence lacked safe local and staging suite orchestration

## Reproduction

The production Go/No-Go validation listed multiple performance and reliability blockers, but operators had to run many individual scripts manually:

```bash
npm run perf:gateway-load
npm run perf:finance-load
npm run chaos:provider-outage
npm run drill:application-rollback
```

There was no single local command to validate the automation bundle, scenario files, and staging safety guards before handing the runbook to staging operators.

## Root Cause

The first implementation added individual load, chaos, and recovery scripts, but it did not include:

1. a local preflight suite for safe script validation
2. staging suite wrappers for load, chaos, and recovery batches
3. evidence output that maps local automation verification back to the Go/No-Go plan

That made the plan executable only by careful manual sequencing, which is too fragile for a launch gate.

## Fix

Added:

1. `npm run perf:local-reliability-suite`
2. `npm run perf:staging-load-suite`
3. `npm run chaos:staging-suite`
4. `npm run drill:staging-recovery-suite`

The local suite validates CI performance smoke, docs/release gates, shell syntax, scenario JSON, HTTP runner wiring, and staging confirmation guards. The staging suites preserve the existing explicit environment confirmations and write evidence directories for operators to attach to validation.

During verification, the first local suite implementation also failed when `SYNAPSE_PERF_OUT_DIR` pointed outside the repository because the report generator forced a repo-relative path. The report path now falls back to an absolute path for external output directories.

## Verification

```bash
npm run perf:local-reliability-suite
```

Observed result:

```text
22 passed, 0 skipped, 0 failed
```

The local suite covered automation, scenario, staging-safety, gateway health, and admin-front login checks.

Additional external output verification:

```bash
SYNAPSE_PERF_OUT_DIR=/tmp/synapse-local-reliability-suite-check \
SYNAPSE_LOCAL_SUITE_SKIP_HTTP_SMOKE=1 \
npm run perf:local-reliability-suite
```

Expected result: report generation succeeds with an absolute evidence path.

## Residual Risk

This fix proves the automation bundle is runnable and guarded locally. It does not prove staging capacity, chaos resilience, rollback, restore, signer recovery, or production readiness. Those items remain NO-GO until staging evidence is attached.
