# Bug Report: Settlement

**Page:** Settlement (Owner Reconciliation Preview) (`/dashboard/settlement`)  
**Date:** 2026-04-07  
**Test Status:** PASS ✅

No bugs found. Page loads correctly with:
- "Reconciliation Preview" heading and compatibility note
- Status filter dropdown (All)
- Four summary cards: provider_receivable (estimated), provider_gross, platform_fee, owner_refundable (wallet snapshot) — all showing $0.0000
- "Provider Payout Exposure" section
- "Owner Refund Exposure" section with "Refund workflow stays treasury-controlled" button
- Note: "Provider payout executes in Provider Settlements" button (links to `/provider/settlements`)

---

## Provider Settlements (`/provider/settlements`)

**Test Status:** PASS ✅

Loads correctly with:
- "Settlement Pipeline" heading and description
- EIP-712 withdrawal ticket flow explanation
- Amount input (blank = full available USDC)
- "Signer Unavailable" and "Resume Pending" action buttons
- Security Contract sidebar: replay protection and lock rules documented inline

![Settlement screenshot](../../test/gateway/screenshots/settlement.png)  
![Provider Settlements screenshot](../../test/gateway/screenshots/provider-settlements.png)
