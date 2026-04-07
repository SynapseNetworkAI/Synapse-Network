# Bug Report: Invocations

**Page:** Invocations (`/dashboard/invocations`)  
**Date:** 2026-04-07  
**Test Status:** PASS ✅

No bugs found. Page loads correctly with:
- Brief loading skeleton during initial API fetch (expected — dynamic import + async data)
- Fully loaded state shows:
  - Search input ("Search invocation, request, service")
  - "All status" filter dropdown + Apply / Reset buttons
  - Stats cards: ROWS IN PAGE (0), SUCCEEDED OR ACCEPTED (0), FAILED IN PAGE (0)
  - Table headers: INVOCATION ID, REQUEST, SERVICE, AGENT, COUNTERPARTY, COST (USDC), LATENCY, STATUS
  - Empty state: "No invocation logs found for the current filters."

**Note:** First screenshot captured skeleton state — page resolves correctly on second load. Not a bug.

![Invocations screenshot](../../test/gateway/screenshots/invocations.png)
