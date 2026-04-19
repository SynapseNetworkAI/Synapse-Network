# BUG-FRONT-QUICK-ACCESS-NAVIGATION

**Status:** Fixed
**Area:** `services/user-front`
**Date:** 2026-04-19

## Reproduction

1. Open `http://localhost:3000/dashboard/overview`.
2. Open the top navbar Quick Access search.
3. Search for `Credits` or `Discovery`.
4. Click the matching result.

## Expected Behavior

The dialog should navigate to the selected route and close:

- `Credits` -> `/dashboard/billing/credits`
- `Discovery` -> `/dashboard/discovery`

Pressing `Enter` should activate the highlighted result. Selecting the current page should only close the dialog.

## Actual Behavior

The result row was clickable in the UI, but browser verification did not have a dedicated regression check for the route change. The existing handler also closed the dialog before calling `router.push`, which made the behavior more fragile under real browser navigation and React unmount timing.

## Root Cause

Quick Access used an inline `handleNavigate(href)` path that closed the portal before routing. Mouse click and keyboard activation depended on the same fragile ordering, and the browser verification suite did not assert Quick Access result navigation.

## Fix

- Route activation now uses one `activateEntry(entry)` path for click and `Enter`.
- Navigation calls `router.push(entry.href)` before closing the dialog.
- Current-route selection closes without redundant navigation.
- Result rows expose stable `data-testid` and `data-href` attributes for browser verification.
- The user-front browser verification script now clicks Quick Access results and captures screenshot evidence.

## Verification

```bash
cd services/user-front && yarn test src/components/QuickAccessDialog.test.tsx
npm run ci:user-front-pages
npm run ci:docs
npm run ci:frontend
USER_FRONT_BASE_URL=http://localhost:3000 node scripts/ui/verify_user_front_pages.mjs
```

Executed verification:

- `cd services/user-front && yarn test src/components/QuickAccessDialog.test.tsx`: 5 tests passed.
- `npm run ci:user-front-pages`: 7 tests passed.
- `npm run ci:docs`: passed.
- `npm run ci:frontend`: lint, 182 Vitest tests, and production build passed.
- Focused Playwright evidence: `output/playwright/quick-access-verification/2026-04-19T024543745Z/report.md`, 2 passed / 0 failed.

Expected screenshot evidence:

- `quick-access-open.png`
- `quick-access-credits-result.png`
- `quick-access-after-credits-navigation.png`
- `quick-access-discovery-result.png`
- `quick-access-after-navigation.png`

## Residual Risk

The browser script validates desktop navbar behavior. Mobile search uses the same `QuickAccessDialog` component, so component coverage protects it, but a separate mobile viewport screenshot can be added if a future mobile-specific regression appears.
