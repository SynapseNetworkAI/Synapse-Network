# BUG-WITHDRAW-IDEMPOTENCY-E2E-CONSUMER-PAYLOAD

## Symptom

The first run of `npm run e2e:withdrawal-idempotency-concurrency` failed the Consumer idempotency scenario. The first request created a withdrawal, but the retry returned `409 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`.

## Root Cause

The E2E harness used the scenario name to build the Consumer withdrawal `reason`. The retry used a different scenario label, so the request body was not identical even though the amount and idempotency key were the same.

The Gateway correctly rejected the request as an idempotency payload mismatch.

## Fix

Use the same scenario label for the first Consumer request and its retry so the request body is byte-for-byte equivalent for the idempotent replay case. The mismatch branch still changes the amount and must continue returning `409`.

## Verification

- `npm run e2e:withdrawal-idempotency-concurrency`
