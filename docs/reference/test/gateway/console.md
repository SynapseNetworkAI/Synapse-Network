# Test Plan: Provider Console Page

**Route:** `/dashboard/console`  
**Component:** redirect → Provider Console

## Purpose
Provider-role overview. Redirect target from `/dashboard/console`.

## Test Cases

### TC-CO-01: Route resolves (no 404)
- Navigate to `/dashboard/console`
- **Expected:** Page loads or redirects cleanly (not 404 / blank)

### TC-CO-02: Provider stats visible
- **Expected:** Provider-side stats (total earnings, active services, invocations served) if wallet connected

### TC-CO-03: Appropriate empty state if not a provider
- **Expected:** If user has no provider role, helpful message shown

## Pass Criteria
Route resolves, no crash.
