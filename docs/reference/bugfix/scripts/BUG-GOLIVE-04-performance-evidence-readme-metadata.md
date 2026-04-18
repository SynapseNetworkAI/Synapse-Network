# BUG-GOLIVE-04 - performance evidence README missed docs metadata

## Reproduction

Run:

```bash
npm run ci:docs
```

The docs gate failed with:

```text
docs/evidence/performance/README.md is a README entrypoint but missing '- Status:' in the top metadata block.
```

## Root Cause

The new performance evidence README was created with YAML front matter instead of the repository README metadata block expected by `scripts/ci/docs_checks.sh`.

## Fix

Rewrote `docs/evidence/performance/README.md` to use the canonical README metadata format:

```text
- Status:
- Code paths:
- Verified with:
- Last verified against code:
```

## Verification

```bash
npm run ci:docs
```

Expected result:

```text
documentation validation passed
```

## Residual Risk

None for the README metadata issue. The performance evidence directory still must not contain secrets or unredacted production logs.
