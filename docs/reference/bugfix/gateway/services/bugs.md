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

---

## BUG-SERVICES-02: Owner Service List Returned 500 After Registration

**Date:** 2026-04-16
**Status:** Fixed
**Surface:** `GET /api/v1/services`

### Symptom

The full-chain analytics E2E registered a provider service successfully, then failed while verifying the service list and service discovery flow. The gateway returned `500` from `GET /api/v1/services` instead of the owner service list.

### Root Cause

`list_owner_services()` enriched each service with `service_lifecycle_status(svc)`, but `services/provider/registry/discovery.py` did not import the helper from `payload_helpers.py`. Runtime service registration worked, but the post-registration list path raised:

```text
NameError: name 'service_lifecycle_status' is not defined
```

### Fix

- Imported `service_lifecycle_status` into `services/provider/registry/discovery.py`.
- Added a regression unit test for `list_owner_services()` that verifies lifecycle status, pricing, health, and `runtimeAvailable` enrichment.

### Verification

- `python -m pytest tests/unit/test_registry_discovery_unit.py -q`
- Re-run the ordered full-chain analytics E2E so service registration, service discovery, deposit, invocation, analytics ingestion, and admin analytics verification stay connected.
