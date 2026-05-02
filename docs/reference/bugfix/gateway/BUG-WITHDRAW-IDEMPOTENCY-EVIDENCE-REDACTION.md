# BUG-WITHDRAW-IDEMPOTENCY-EVIDENCE-REDACTION

## Symptom

`npm run ci:withdrawal-idempotency-concurrency-evidence` failed after a passing E2E run. The evidence digest could not be recomputed, and the secret scan flagged `PRIVATE_KEY`.

## Root Cause

The new evidence redaction treated every `0x` + 64 hex string as secret-like material. That incorrectly redacted public chain evidence such as `txHash` and `ticketHash`, while the report digest had been computed from the unredacted in-memory evidence.

The CI secret scan had the same broad pattern and misclassified public transaction hashes as private keys.

## Fix

- Keep public chain hashes in evidence.
- Redact by sensitive field names and bearer/JWT token patterns instead of generic 32-byte hex values.
- Leave `txHash` and `ticketHash` available for evidence verification.

## Verification

- `npm run e2e:withdrawal-idempotency-concurrency`
- `npm run ci:withdrawal-idempotency-concurrency-evidence`
