# BUG-FORUM-DOGFOOD-01 Verification Selector Hardening

**Status:** Fixed
**Area:** `scripts/ui`
**Date:** 2026-04-19

## Reproduction

1. Seed forum and feedback records with `node scripts/e2e/forum_feedback_seed.mjs`.
2. Run `node scripts/ui/dogfood_forum_feedback.mjs`.
3. Re-run the dogfood flow so the database contains multiple topics with the same generated title pattern.

## Expected Behavior

The dogfood script should deterministically verify Forum tabs and the exact topic created for the current run. Repeated local runs should not create false failures when older evidence rows still exist in the database.

## Actual Behavior

The first browser dogfood attempt failed before the product flow completed:

- The `Top` tab selector matched the `New topic` button text and caused a strict-mode locator failure.
- The topic click selector matched duplicate titles from previous dogfood runs, so Playwright could not choose the current run's topic deterministically.

## Root Cause

The verification harness used text selectors that were too broad for a persistent dogfood database. The product UI can legitimately contain multiple similarly named seeded topics, so test code must use exact roles or route identifiers instead of matching partial copy.

## Fix

- The `Top` tab assertion now uses an exact button name match.
- The topic detail step now follows the exact `a[href="/forum/{topicId}"]` generated for the current fixture.
- The dogfood report keeps DB reconciliation as the final source of truth for seeded feedback, topics, replies, and resolved state.

## Verification

```bash
node --check scripts/e2e/forum_feedback_seed.mjs
node --check scripts/ui/dogfood_forum_feedback.mjs
node scripts/e2e/forum_feedback_seed.mjs
node scripts/ui/dogfood_forum_feedback.mjs
```

Executed verification:

- `node --check scripts/e2e/forum_feedback_seed.mjs`: passed.
- `node --check scripts/ui/dogfood_forum_feedback.mjs`: passed.
- `node scripts/e2e/forum_feedback_seed.mjs`: created local fixture data.
- `node scripts/ui/dogfood_forum_feedback.mjs`: passed with 8 checks, 0 failed, 0 warnings.

Evidence report:

- `output/dogfood/forum-feedback/2026-04-19T044041643Z/report.md`

## Residual Risk

This bug was in the verification harness, not the Forum product path. The script still depends on local gateway, Postgres, user-front, and browser availability, so environment failures should be treated separately from product regressions.
