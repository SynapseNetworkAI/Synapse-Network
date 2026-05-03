# BUG-WITHDRAW-RISK-E2E-HARNESS

## Status

Fixed in local E2E harness.

## Symptom

`npm run e2e:withdrawal-risk-policy` initially failed on harness assumptions:

- Withdrawal create endpoints use `status` as the withdrawal flow status (`REQUESTED`, `PENDING_MANUAL_REVIEW`, etc.), not a generic `success` marker.
- Concurrent same-owner/same-amount requests can return the same active withdrawal row; the safety assertion must be one unique withdrawal ID, one DB row, and one locked balance.
- Provider matured withdrawals need local on-chain vault liquidity before auto-signed tickets can be issued.
- Reusing an old user-front dev server can make screenshot evidence stale after local contract redeploys.

## Fix

- Assert HTTP 2xx plus the withdrawal status.
- Assert unique withdrawal IDs and DB balance locks for concurrency.
- Mint local MockUSDC into `SynapseCore` before provider auto-signing checks.
- Restart user-front from the E2E wrapper before screenshot capture.

## Verification

```bash
npm run e2e:withdrawal-risk-policy
```
