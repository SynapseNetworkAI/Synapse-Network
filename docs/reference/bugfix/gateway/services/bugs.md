# Bug Report: Services (Dashboard)

**Page:** My Services - Dashboard (`/dashboard/services`)  
**Date:** 2026-04-07  
**Test Status:** PASS ✅

No bugs found. Page loads correctly with:
- "My Services" heading and description
- "Back to Dashboard" button
- "+ New Service" (green CTA)
- "Wallet not connected. Connect and sign in to manage your API services and service definitions." message
- Info banner: "Active services are runtime-live. Switch a service to Inactive before editing its contract or routing fields."

**Note:** The provider-role version of services is at `/provider/services` (API Services) and has richer functionality (search, status filter, pagination). `/dashboard/services` is the owner-context entry point.

![Services screenshot](../../test/gateway/screenshots/services.png)

---

## Provider Services (`/provider/services`)

**Test Status:** PASS ✅

Loads correctly with:
- "API Services" heading
- "Search Service ID or name" input
- "All Status" dropdown filter
- "Search" button + "New Service" button
- Table headers: SERVICE, SERVICE ID, PRICING, STATUS, CALLABLE, ACTION
- "Showing 0-0 of 0" pagination
- Empty state: "No API services match the current filters."

![Provider Services screenshot](../../test/gateway/screenshots/provider-services.png)
