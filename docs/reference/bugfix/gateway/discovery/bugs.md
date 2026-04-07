# Bug Report: Discovery

**Page:** Discovery (`/dashboard/discovery`)  
**Date:** 2026-04-07  
**Test Status:** PASS ✅

No bugs found. Page loads correctly with:
- "Search by service name or ID…" input
- "Sort by Best Match" and "Order Descending" dropdowns
- "Search" button
- Table headers: SERVICE, SERVICE ID, TAGS, PRICE, CALL COUNT, CALL AMOUNT, ROUTE STATUS, HEALTH
- Correct empty state: "No services found." (expected with no registered services in local dev)

![Discovery screenshot](../../test/gateway/screenshots/discovery.png)
