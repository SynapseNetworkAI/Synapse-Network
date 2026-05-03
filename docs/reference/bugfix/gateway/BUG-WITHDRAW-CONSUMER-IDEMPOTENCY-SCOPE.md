# BUG-WITHDRAW-CONSUMER-IDEMPOTENCY-SCOPE

## Status

Fixed.

## Symptom

The withdrawal risk-policy E2E found that a Consumer withdrawal could reuse the same `X-Idempotency-Key` with a different amount and receive HTTP 200 instead of `409 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`.

## Root Cause

`create_consumer_withdraw_intent` checked Redis under the `consumer_withdraw_intent` scope, but finalized the response through the shared refund helper, which stored it under `refund_intent`. The second Consumer withdrawal request therefore did not find the original Consumer idempotency record.

## Fix

Consumer withdrawal now finalizes idempotency under the same `consumer_withdraw_intent` scope it checks, including the Postgres fallback path when Redis is unavailable.

## Verification

```bash
npm run e2e:withdrawal-risk-policy
```
