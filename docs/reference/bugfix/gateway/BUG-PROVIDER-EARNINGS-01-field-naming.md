# BUG-PROVIDER-EARNINGS-01 — Provider Earnings Endpoint Returns Wrong Field Shape

**Severity:** Low  
**Component:** `services/gateway` — `/v1/providers/earnings/summary` response field naming  
**Reported:** 2026-04-07  
**Status:** Documented (test script fixed; no backend change needed)

---

## Summary

The provider earnings summary endpoint returns `providerNetEarned` and `providerReceivable` as the
primary fields for provider income. Earlier test scripts expected `net_earnings` / `netEarnings`
and saw `0.0` for all earnings despite the provider actually having received funds.

---

## Actual Response Shape

```json
{
  "status": "success",
  "summary": {
    "ownerAddress": "0x3c44...",
    "totalApiCalls": 1,
    "totalEarned": 0.01,
    "totalProtocolFee": 0.001,
    "totalRoutingTax": 0.0001,
    "providerNetEarned": 0.0091,
    "providerReceivable": 0.009,
    "duplicateRowsDropped": 0,
    "recentCalls": [...]
  }
}
```

---

## Fee Formula (verified in E2E)

| Field             | Formula                                 | Example (price=0.01 USDC) |
|-------------------|-----------------------------------------|--------------------------|
| `totalEarned`     | service unit price                      | 0.01                     |
| `totalProtocolFee`| `price × 0.10`                          | 0.001                    |
| `totalRoutingTax` | fixed 0.0001 USDC                       | 0.0001                   |
| `providerNetEarned`| `price - platformFee + routingTax`     | 0.0091                   |
| `providerReceivable`| pending withdrawal balance            | 0.009                    |

Consumer charge: `price + routingTax = 0.01 + 0.0001 = 0.0101 USDC` ✓ (verified in E2E run)

---

## Fix

Updated `scripts/e2e_fullflow_test.py` `verify_billing()` to read the correct field path:

```python
earnings = r2.json().get("summary", r2.json())
net = float(
    earnings.get("providerNetEarned", 0)
    or earnings.get("net_earnings", 0)
    or earnings.get("netEarnings", 0)
    or 0
)
receivable = float(earnings.get("providerReceivable", 0) or 0)
```

---

## No Backend Change Required

The backend API returns the correct data with the correct fields. This was a test-script read bug.
