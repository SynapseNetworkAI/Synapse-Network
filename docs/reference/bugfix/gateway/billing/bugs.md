# Bug Report: Billing

**Page:** Billing / Payments (`/dashboard/billing`) + Credits (`/dashboard/billing/credits`)  
**Date:** 2026-04-07  
**Test Status:** PASS ✅

## Payments sub-page
No bugs. Shows:
- FROM / TO date range inputs (Jan 1, 2026 → Apr 7, 2026)
- "Reset to last 3 months" link
- Table headers: Transaction ID, Status, Payment Method, Amount, Date, Invoice
- Empty state: "No payment activity found for the selected range."

## Credits sub-page
No bugs. Shows:
- "Remaining balance: $0.00" with info icon
- "Purchase credits" button
- Current Billing Cycle: Apr 1 – Apr 30, 2026 (23 days remaining)
- "Manage Spend Cap" section and button

![Billing Payments screenshot](../../test/gateway/screenshots/billing.png)  
![Billing Credits screenshot](../../test/gateway/screenshots/billing-credits.png)
