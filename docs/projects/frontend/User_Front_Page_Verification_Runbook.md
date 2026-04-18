# User Front Page Verification Runbook

- Status: canonical
- Code paths: `services/user-front/src/app/`, `services/user-front/src/components/`, `scripts/ui/verify_user_front_pages.mjs`
- Scope: `services/user-front`
- Last verified against code: 2026-04-18
- Related design matrix: `docs/projects/frontend/User_Front_Page_Function_and_Verification.md`
- Registry: `services/user-front/src/app/user-front-page-registry.json`

## What To Verify

Verify four different things separately:

1. **Route coverage**: every Next route has a documented function and verification mode.
2. **Click behavior**: buttons, redirects, sidebar anchors, and page links navigate correctly.
3. **Visual quality**: page layout, component spacing, dark theme coordination, empty states, and responsive behavior are acceptable.
4. **Data truth**: pages that claim to show live state read from the gateway, wallet, or chain instead of mock data.

Do not collapse these into one screenshot review. A page can look correct and still have broken navigation or fake data.

## Verification Commands

### 1. Static Page Registry Check

```bash
npm run ci:user-front-pages
```

Pass criteria:

- Every `services/user-front/src/app/**/page.tsx` and `route.ts` is represented in the registry.
- Redirect routes declare `redirectsTo`.
- Data-backed pages declare concrete API, wallet, chain, or localStorage sources.
- Screenshot-required pages declare stable screenshot file names.

### 2. Frontend Unit/Component Regression

```bash
npm run ci:frontend
```

Pass criteria:

- Existing marketplace, docs, billing, withdraw, provider, and analytics contract tests pass.
- TypeScript and lint gates pass.
- No test is weakened to hide a real navigation, money, or data-contract bug.

### 3. Browser Click and Screenshot Verification

Start user-front first:

```bash
cd services/user-front
yarn dev
```

Then run:

```bash
USER_FRONT_BASE_URL=http://localhost:3000 node scripts/ui/verify_user_front_pages.mjs
```

Pass criteria:

- Every documented non-redirect page renders expected text.
- Home page CTAs navigate to `/dashboard/overview` and `/dashboard/developer`.
- Redirect routes land on documented targets.
- `/docs/concepts#idempotency` can click back to `#settlement`.
- Marketplace search and tag controls are visible.
- Screenshot files are generated for core pages.
- No uncaught browser console errors.
- No core screenshot page has horizontal overflow.

### 4. Real Backend Data Verification

Start the gateway and user-front. Then run:

```bash
USER_FRONT_BASE_URL=http://localhost:3000 \
USER_FRONT_VERIFY_REAL_BACKEND=1 \
USER_FRONT_GATEWAY_HEALTH_URL=http://127.0.0.1:8000/health \
node scripts/ui/verify_user_front_pages.mjs
```

Pass criteria:

- Gateway health endpoint returns success.
- `/marketplace/registry.json?page=1&pageSize=10` returns `status=success`, valid pagination metadata, and available-only services.
- `/` and `/marketplace` call real public gateway APIs and receive successful responses.
- Authenticated consumer/provider pages are marked blocked unless a wallet/JWT fixture is provided.

## Screenshot or Simulated Click?

Use simulated clicks for:

- Route changes.
- Redirects.
- Sidebar anchors.
- CTA buttons.
- Marketplace controls.
- API endpoint detail links.
- Any control that changes data, filter, page, or route.

Use screenshots for:

- Visual hierarchy.
- Component spacing and alignment.
- Theme consistency.
- Empty/loading/error state review.
- Release evidence.

Screenshots should support a functional test report, not replace it.

## Visual Review Checklist

For every screenshot-required page, review:

- Header, controls, and primary CTA alignment are intentional.
- Typography hierarchy is clear and not cramped.
- Controls in the same group share radius, height, border, and spacing.
- Dark background surfaces have enough contrast.
- Empty state explains whether data is unavailable, still loading, or genuinely empty.
- Mobile/tablet follow-up screenshots have no horizontal overflow.
- Marketplace list rows are scan-friendly: service name, summary, price, billing unit, tags, status, update time, and action are visually separable.

If a page fails visual review but functional tests pass, record a UX/design bug. Do not mark it as a backend or route bug.

## Data Truth Checklist

For public data pages:

- Confirm request URL and HTTP status in `report.md`.
- Confirm rendered empty state is consistent with a real empty response.
- Confirm marketplace JSON filters unavailable services before pagination.

For authenticated data pages:

- Use a wallet/JWT fixture for full verification.
- Verify balance, withdrawal, invocation, service, and provider earnings values against the gateway response.
- Verify no page renders stale fixture data after a failed fetch.
- Verify loading and error states are visible and not silently swallowed.

If a wallet/JWT fixture is not available, mark the data verification as blocked, not passed.

## Bug Recording Rule

If verification finds a bug:

- Route/navigation/docs bug: `docs/reference/bugfix/frontend/BUG-FRONT-PAGE-XX-*.md`
- Data-contract or backend-read bug: `docs/reference/bugfix/frontend/BUG-FRONT-DATA-XX-*.md`
- Visual coordination bug: `docs/reference/bugfix/frontend/BUG-FRONT-UX-XX-*.md`

Each record must include:

- Reproduction steps.
- Expected behavior.
- Actual behavior.
- Root cause.
- Fix.
- Verification command and report path.
- Residual risk.

## Fully Verified Definition

The full user-front surface is considered verified only when:

- `npm run ci:user-front-pages` passes.
- `npm run ci:frontend` passes.
- Browser verification report has zero failures.
- Real backend verification report has zero failures for public data pages.
- Authenticated data pages have wallet/JWT evidence or are explicitly blocked.
- Visual screenshot review finds no P0/P1 usability or component-coordination issue.
- Any discovered bug has a bugfix record and a successful rerun.
