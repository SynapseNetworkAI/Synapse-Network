# BUG-WITHDRAW-IDEMPOTENCY-COMPLETE-REPLAY

## Symptom

`e2e:withdrawal-idempotency-concurrency` failed after Consumer withdrawal maturity moved to T+7 and after complete APIs were made replay-stable.

- Consumer withdrawal fixtures seeded deposits only about 25 hours old, so mature withdrawable balance was `0.000000`.
- Complete concurrency expected exactly one HTTP success, but the intended idempotent contract is one database state advance and stable success for same-`txHash` replays.
- When a Provider runtime was unavailable, the upstream failure path attempted to write synthetic billing data through a typed Postgres repository and escalated the expected upstream failure into `500`.

## Root Cause

The E2E fixture and docs still encoded pre-T+7 and "duplicate complete must fail" assumptions. The runtime failure logger also passed fallback billing rows in a shape incompatible with the Postgres typed repository.

## Fix

- Seed Consumer deposits older than 7 days in the idempotency/concurrency E2E.
- Treat same-`txHash` complete calls as stable idempotent replays while asserting funds, `tx_hash`, audit, and ticket consumption are not duplicated.
- Keep different-`txHash` complete attempts rejected.
- Make upstream failure billing append best-effort so Provider unavailability returns the correct gateway error instead of masking it as an internal server error.
- Restore discovery query aliases (`q` / `search_query`) so local/staging canonical Provider services are searchable by stable `serviceId`.

## Verification

- `npm run e2e:withdrawal-idempotency-concurrency`
- `npm run ci:withdrawal-idempotency-concurrency-evidence`
- `npm run ci:state-idempotency-safety`
- Focused Gateway finance/storage/router unit suites.
