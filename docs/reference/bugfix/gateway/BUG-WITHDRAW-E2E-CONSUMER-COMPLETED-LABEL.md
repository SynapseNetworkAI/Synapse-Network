# BUG-WITHDRAW-E2E-CONSUMER-COMPLETED-LABEL

## Symptom

`npm run e2e:withdrawal-risk-policy` completed the Consumer on-chain claim and Gateway complete step, but `/dashboard/billing` still rendered the successful withdrawal status as `Succeeded`.

The final-state E2E requires the Consumer DOM and screenshot evidence to show `Completed`, matching the Provider withdrawal page and the backend `COMPLETED` status.

## Root Cause

The Consumer billing page English status copy mapped the succeeded transaction state to `Succeeded` instead of the product-wide final withdrawal label `Completed`.

## Fix

- Updated the Consumer billing i18n success label to `Completed`.
- Added a targeted `OwnerBillingPage` assertion for the final status label.
- Reran the final-state withdrawal-risk E2E and confirmed `/dashboard/billing` DOM matched `Completed` after Gateway completion.

## Verification

- `npm run e2e:withdrawal-risk-policy`
- `yarn test src/components/dashboard-workspace/OwnerBillingPage.test.tsx`
