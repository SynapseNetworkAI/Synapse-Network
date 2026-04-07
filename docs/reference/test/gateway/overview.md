# Test Plan: Overview Page

**Route:** `/dashboard/overview`  
**Component:** `DashboardOverviewPage`

## Purpose
Primary landing page after wallet connect. Shows owner's balance, agent count, recent invocations, and system status at a glance.

## Prerequisites
- Wallet not connected → page should show connect prompt or loading state gracefully
- Wallet connected + session auth → full data displayed

## Test Cases

### TC-OV-01: Page renders without crash
- Navigate to `/dashboard/overview`
- **Expected:** Page loads, no blank screen, no unhandled JS error
- **Screenshot:** `screenshots/overview-initial.png`

### TC-OV-02: Wallet-not-connected state
- Load page without wallet connection
- **Expected:** Connection prompt or graceful empty state shown; no crash

### TC-OV-03: Header stats row visible
- **Expected:** Balance, agent count, or similar stats visible in header area

### TC-OV-04: Quick action buttons present
- **Expected:** At least one action button (e.g. "Add Funds", "Create Agent") visible

### TC-OV-05: Refresh / loading indicator
- Click refresh if present
- **Expected:** Loading spinner shown then data reloads

### TC-OV-06: Navigation links work
- Click sidebar nav items from Overview
- **Expected:** Route changes correctly

## Pass Criteria
All P0 and P1 test cases pass. Screenshot shows populated header and at least one data section.
