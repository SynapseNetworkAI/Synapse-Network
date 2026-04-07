# BUG-STATUS-01: failed_retryable invocations shown as "succeeded" in Invocations page

## Severity
Medium — incorrect status display misleads users about invocation outcomes

## Symptom
In the Invocations dashboard page (`/dashboard/invocations`), invocations with
backend status `failed_retryable` are displayed with a green "SUCCEEDED" badge instead
of the correct red "FAILED" badge.

## Root Cause

`parseStatus()` in `services/user-front/src/utils/usageApi.ts` only matches
a strict set of known statuses and falls through to `"succeeded"` for anything else:

```typescript
// BEFORE (buggy)
function parseStatus(value: unknown): DeductionStatus {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized === "accepted" || normalized === "succeeded" || normalized === "refunded" || normalized === "failed") {
    return normalized;
  }
  return "succeeded";  // ← bug: maps "failed_retryable" → "succeeded"
}
```

The gateway persists `inv.status = "failed_retryable"` for invocations that failed
but are eligible for retry (upstream timeout, upstream 5xx, etc.). The frontend
`DeductionStatus` type only allows: `"accepted" | "succeeded" | "refunded" | "failed"`.

## Impact
- Invocations that failed (consumer NOT charged, upstream returned error) appear as green "SUCCEEDED"
- "FAILED IN PAGE" summary counter under-counts failed invocations
- "SUCCEEDED OR ACCEPTED" counter inflates

## Verification
From DB, 7 of 14 invocations had `status = "failed_retryable"` — all displayed as `succeeded`.

## Fix Applied
`parseStatus()` now maps any status starting with `"failed"` to `"failed"`:

```typescript
// AFTER (fixed)
function parseStatus(value: unknown): DeductionStatus {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized === "accepted" || normalized === "succeeded" || normalized === "refunded" || normalized === "failed") {
    return normalized;
  }
  if (normalized.startsWith("failed")) {
    return "failed";
  }
  return "succeeded";
}
```

**File:** `services/user-front/src/utils/usageApi.ts`

## Why Invocations Page Shows 0

The Invocations page also shows 0 rows when **no wallet is connected** in the browser.
The component checks:
```typescript
if (!address || !isSessionAuthenticated) {
  setRows([]);
  ...
  return;
}
```
Backend API (GET /api/v1/usage/logs) has the correct data. Connect wallet in browser
to see real invocations.

## Billing Math Reference

For a service with `price = 0.01 USDC`:

| Field | Value | Formula |
|---|---|---|
| consumer_deducted | 0.0101 | price + routingTax |
| provider_net_earned | 0.0091 | totalCharge - protocolFee |
| platformFeeAccrued | 0.0011 | protocolFee + routingTax (gross fees) |
| totalCharge | 0.0101 | price + routingTax |
| protocolFee | 0.0010 | price × 10% |
| routingTax | 0.0001 | fixed |

Note: `platformFeeAccrued` tracks gross fees collected (protocolFee + routingTax).
The platform's net income is `protocolFee = 0.001`. The `routingTax` is routed
through but ends up credited to the provider via `totalCharge - protocolFee`.
