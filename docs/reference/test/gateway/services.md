# Test Plan: My Services Page

**Route:** `/dashboard/services`  
**Component:** `DashboardServicesPage`

## Purpose
Provider's registered service management — activate, deactivate, delete services.

## Test Cases

### TC-SV-01: Page renders without crash
- Navigate to `/dashboard/services`
- **Expected:** Page loads with services list or empty state

### TC-SV-02: Services table/cards visible
- **Expected:** Service rows with name, status badge, pricing, actions

### TC-SV-03: Status badge correct
- **Expected:** active/inactive/archived badges shown per service

### TC-SV-04: Toggle service active/inactive
- Click activate/deactivate toggle
- **Expected:** Confirmation dialog shown; optimistic update applied

### TC-SV-05: Delete service
- Click delete on a service
- **Expected:** Confirmation dialog before deletion

### TC-SV-06: Register new service
- Click "Register Service" or similar button
- **Expected:** Registration form or redirect shown

### TC-SV-07: Wallet connect required
- Without wallet: connect prompt shown; no crash

## Pass Criteria
Page loads, service list visible, status toggle works.
