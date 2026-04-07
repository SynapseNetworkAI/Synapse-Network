# Test Plan: Invocations Page

**Route:** `/dashboard/invocations`  
**Component:** `DashboardInvocationsPage` → `DashboardInvocationsContent`

## Purpose
Historical log of all agent invocations. Filter by date/status/agent, view per-call cost and status.

## Test Cases

### TC-IN-01: Page renders without crash
- Navigate to `/dashboard/invocations`
- **Expected:** Page loads (loading skeleton then table)

### TC-IN-02: Loading skeleton shows during fetch
- **Expected:** Animated skeleton rows visible before data loads

### TC-IN-03: Invocation table headers present
- **Expected:** Columns visible (e.g. Agent, Service, Time, Cost, Status)

### TC-IN-04: Date range filter works
- Change from/to date filter
- **Expected:** Table updates rows based on range

### TC-IN-05: Status filter works
- Select a status filter (success/error)
- **Expected:** Table filters correctly

### TC-IN-06: Stats row (total invocations, total cost)
- **Expected:** Three stat cards visible above table

### TC-IN-07: Empty state
- Filter to a range with no data
- **Expected:** "No invocations" empty state shown

## Pass Criteria
Page renders, table visible, filters functional.
