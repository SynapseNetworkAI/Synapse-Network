# BUG-ADMIN-WITHDRAWAL-E2E-TOTP-WINDOW

## Summary

The admin withdrawal dogfood script could fail randomly when the step-up modal opened near the end of a TOTP cycle. The UI correctly disabled the confirm button in the last guarded seconds, but the script still attempted to click it.

## Reproduction

1. Run `npm run e2e:admin-withdrawal-approval:dogfood`.
2. If the step-up modal appears with less than the guarded TOTP window remaining, the confirm button is disabled.
3. The script times out trying to click `确认放行`.

## Root Cause

The script generated the TOTP code immediately without checking the remaining TOTP window, while the frontend intentionally disables confirmation near expiry.

## Fix

`scripts/ui/dogfood_admin_withdrawal_approval.mjs` now waits for a fresh TOTP window before filling the code, then waits for the confirm button to become enabled before clicking.

## Verification

- `npm run e2e:admin-withdrawal-approval:dogfood`
- Final passing report: `output/dogfood/admin-withdrawal-approval/2026-04-20T075358383Z/report.md`

## Residual Risk

If the local/admin TOTP secret changes, the script must be run with `ADMIN_TOTP_SECRET=<base32-secret>`.
