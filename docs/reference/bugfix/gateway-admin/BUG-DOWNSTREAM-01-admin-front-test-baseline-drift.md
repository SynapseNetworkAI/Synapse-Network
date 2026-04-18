# BUG-DOWNSTREAM-01: Admin Front Test Baseline Drift

## Status

Fixed and verified on 2026-04-18 during downstream adaptive concurrency implementation.

## Reproduction

Run:

```bash
cd services/admin-front
yarn test
```

Observed failures:

- `src/lib/navigation.test.ts` expected `/role-permissions` to resolve as a page, but the test fixture created it with the default `category` node type.
- `src/features/review-history/review-history-presenters.test.ts` expected the old `CANCELLED` label `已取消 / 已释放`, while the canonical shared status label is now `已取消`.

## Root Cause

The admin-front test fixtures drifted from current product semantics:

- Navigation pages must use `nodeType: "page"` before `buildAdminNavigation()` treats their `href` as navigable.
- Review history presenters now delegate status text to the shared withdrawal status domain labels.

## Fix

- Marked the `role-permissions` fixture as `nodeType: "page"`.
- Updated the review-history `CANCELLED` label expectation to the canonical shared label.

## Verification

```bash
cd services/admin-front
yarn test
```

Result: all admin-front tests passed.

## Residual Risk

Low. This was a test baseline mismatch, not a runtime regression in the downstream concurrency guard.
