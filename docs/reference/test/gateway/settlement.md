# Test Plan: Settlements Page

**Route:** `/dashboard/settlement`  
**Component:** `DashboardSettlementPage`

## Purpose
Provider settlement dashboard — USDC wallet balance, deduction rows by status, totals.

## Test Cases

### TC-SE-01: Page renders without crash
- Navigate to `/dashboard/settlement`
- **Expected:** Page loads with settlement data or empty state

### TC-SE-02: Wallet USDC balance shown
- **Expected:** USDC balance card visible

### TC-SE-03: Settlement totals displayed
- **Expected:** At least 2 summary cards (wallet balance + pending/total earnings)

### TC-SE-04: Status filter tabs
- **Expected:** Filter options: All / Accepted / Succeeded / Refunded / Failed

### TC-SE-05: Filter by status
- Click "Succeeded" filter
- **Expected:** Table rows update to only show succeeded rows

### TC-SE-06: Settlement rows table
- **Expected:** Table with provider rows, amounts, status labels

### TC-SE-07: "All" filter shows all rows
- **Expected:** Best default state

## Pass Criteria
Page loads, filter tabs work, totals visible.
