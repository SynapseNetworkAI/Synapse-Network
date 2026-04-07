# Test Plan: Billing Credits Page

**Route:** `/dashboard/billing/credits`  
**Component:** `OwnerCreditsPage`

## Purpose
Redeem voucher codes for USDC credits. Shows current credit balance.

## Test Cases

### TC-BC-01: Page renders without crash
- **Expected:** Page loads showing credit balance section

### TC-BC-02: Redeem Voucher button / input present
- **Expected:** Voucher code input field visible

### TC-BC-03: Redeem with invalid code
- Enter random string
- **Expected:** Error feedback shown (not crash)

### TC-BC-04: Current balance displayed
- **Expected:** Current credit/USDC balance visible

## Pass Criteria
Page loads, redemption UI present.
