# BUG-GOLIVE-05 - local perf runner overloaded localhost and reported false PASS

## Reproduction

Run:

```bash
npm run perf:local-smoke
```

Before this fix, the local smoke runner sent requests as fast as every worker could loop. On macOS this exhausted ephemeral ports and produced many errors:

```text
<urlopen error [Errno 49] Can't assign requested address>
```

The generated report still wrote `Local smoke result: PASS`, even though the summary contained unexpected failures.

## Root Cause

The generic HTTP load runner had no request pacing and always exited with status `0` after writing a summary, regardless of unexpected failure rate.

## Fix

Added:

1. `--request-delay-ms` / `SYNAPSE_PERF_REQUEST_DELAY_MS` pacing support.
2. `--max-failure-rate` / `SYNAPSE_PERF_MAX_FAILURE_RATE` threshold support.
3. Local smoke defaults of `concurrency=2` and `requestDelayMs=200`.
4. Non-zero exit when unexpected failures exceed the configured threshold.

## Verification

```bash
npm run perf:local-smoke
```

Expected result after fix:

```text
gateway-health successRate=1.0
admin-front-login successRate=1.0
Local smoke result: PASS
```

## Residual Risk

This remains a local smoke test. It is useful for harness validation and basic local entrypoint performance, but it is not staging or production capacity evidence.
