# Test Plan: Discovery Page

**Route:** `/dashboard/discovery`  
**Component:** `DiscoveryConsolePage`

## Purpose
Browse and search available AI services in the marketplace. Owner can discover services to configure for their agents.

## Test Cases

### TC-DI-01: Page renders without crash
- Navigate to `/dashboard/discovery`
- **Expected:** Page loads with service cards or list

### TC-DI-02: Service list / cards shown
- **Expected:** At least service cards with name, category, pricing visible

### TC-DI-03: Search / filter input present
- **Expected:** Search box or category filter visible

### TC-DI-04: Service details expand
- Click a service card
- **Expected:** Detail view or modal opens showing endpoint, pricing, description

### TC-DI-05: Empty search shows no-results state
- Type a non-existent service name
- **Expected:** Empty state message shown (not crash or blank)

## Pass Criteria
Page renders, service list loads, detail view opens.
