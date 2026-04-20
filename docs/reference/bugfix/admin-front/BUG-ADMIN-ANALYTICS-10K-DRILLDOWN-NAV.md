---
id: bug-admin-analytics-10k-drilldown-nav
title: Admin Analytics 10k dogfood drilldown clicks rendered blank RSC payload pages
status: fixed
created_at: 2026-04-20
updated_at: 2026-04-20
owner: admin-front
---

# BUG-ADMIN-ANALYTICS-10K-DRILLDOWN-NAV

## Reproduction

Run the Admin Analytics browser dogfood against a reconciled analytics fixture:

```bash
ADMIN_ANALYTICS_LOAD_FIXTURE=output/analytics-load/<runId>/fixture.json \
ADMIN_ANALYTICS_LOAD_REPORT=output/analytics-load/<runId>/report.json \
ADMIN_FRONT_URL=http://127.0.0.1:4000 \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
npm run e2e:admin-analytics-10k:dogfood
```

The seven Analytics pages rendered correctly when opened directly. However, clicking the overview drilldown cards and the Budget blocks alert produced failures. The screenshot for the final clicked page was a blank white document, and the page body contained a Next RSC payload stream instead of the rendered admin page.

## Root Cause

The overview drilldown cards and alert action used Next `Link` for cross-topic navigation. In the local dev/staging browser dogfood flow, the client-side RSC navigation could leave the document showing the RSC payload when a navigation request was aborted or retried. This made the actual clickable path less reliable than direct page loads.

## Fix

- Analytics overview drilldown cards now render as normal anchor navigation with stable `data-testid="analytics-drilldown-..."` hooks.
- The Budget blocks alert action now renders as a normal anchor-style button with a stable `data-testid="analytics-alert-budget-blocks"` hook.
- `scripts/ui/dogfood_admin_analytics_10k.mjs` now clicks those stable controls and waits for target page body text before asserting.

## Verification

```bash
node --check scripts/e2e/admin_analytics_10k_fullchain.mjs
node --check scripts/e2e/admin_analytics_10k_reconcile.mjs
node --check scripts/ui/dogfood_admin_analytics_10k.mjs

ADMIN_ANALYTICS_LOAD_FIXTURE=output/analytics-load/aal-20260420025537/fixture.json \
ADMIN_ANALYTICS_LOAD_REPORT=output/analytics-load/aal-20260420025537/report.json \
ADMIN_FRONT_URL=http://127.0.0.1:4000 \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
npm run e2e:admin-analytics-10k:dogfood
```

Result: `37 passed, 0 failed`.

Screenshots:

- `output/analytics-load/aal-20260420025537/screens/09-drilldown-card-clicks.png`
- `output/analytics-load/aal-20260420025537/screens/10-budget-block-alert-drilldown.png`

## Residual Risk

The fix intentionally favors reliable document navigation for admin drilldown links. This avoids the RSC blank-page failure in local/staging dogfood at the small cost of not using client-side route transition for these specific cross-topic links.
