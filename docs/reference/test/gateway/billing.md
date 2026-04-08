# Test Plan: Billing Page

**Route:** `/dashboard/billing`  
**Component:** `OwnerBillingPage`

## Purpose
Transaction history of wallet top-ups, voucher redemptions. Date range filtering on fund records.

## Test Cases

### TC-BI-01: Page renders without crash
- Navigate to `/dashboard/billing`
- **Expected:** Page loads with transaction list or empty state

### TC-BI-02: Date range inputs present
- **Expected:** "From" and "To" date inputs visible, defaulting to 2026-01-01 → today

### TC-BI-03: Transaction list table shown
- **Expected:** Table with columns (Date, Amount, Type, TX ID)
- **Expected:** Date column uses fixed local wall-clock format `YYYY-MM-DD HH:mm:ss`

### TC-BI-04: Date filtering works
- Narrow date range
- **Expected:** Table updates to show only records within range

### TC-BI-05: Payment method label
- **Expected:** "Voucher" or "Wallet" label shown per row

### TC-BI-06: TX ID truncation
- Long transaction IDs shown as `0x...xxxx`
- **Expected:** Truncated format displayed correctly

### TC-BI-07: Credits sub-route accessible
- Navigate to `/dashboard/billing/credits`
- **Expected:** Credits / voucher redemption page loads

## Pass Criteria
Page loads, date filter works, table renders.
