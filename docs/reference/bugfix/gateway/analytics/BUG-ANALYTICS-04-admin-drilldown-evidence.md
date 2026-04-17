# BUG-ANALYTICS-04: Admin Analytics Alerts Lacked Evidence Drilldown

**Date:** 2026-04-17
**Status:** Fixed
**Surface:** Admin Analytics, gateway-admin analytics API, admin-front analytics pages

## Symptom

Admin Analytics showed warning counts such as `2 budget_blocked events in this window` and `failed deposits`, but operators could not click through to understand which service, error code, environment, or correlation ID caused the warning. Provider revenue also showed `Pending 0.02 USDC`, which looked like event-window settlement pending even though it came from the gateway finance projection.

## Root Cause

- The overview `Budget blocks` alert linked back to `/dashboard/analytics`, so clicking `查看` stayed on the same page.
- `pendingSettlementUsdc` is a legacy API field overwritten by `provider_available_to_withdraw_usdc`, but the UI labelled it as pending settlement.
- Money Flow only returned failed deposit counts and error distribution, not recent event samples.

## Fix

- Route budget block alerts to `/dashboard/analytics/risk-health?window=<window>&focus=budget_blocked`.
- Add `budgetBlocks` and `budgetBlockSamples` to risk-health so operators can see `errorCode`, `serviceId`, `surface`, `requiredUsdc`, `availableUsdc`, and `correlationId`.
- Display provider finance projection balance as `Available to withdraw`.
- Add `depositFailureSamples` to money-flow and show recent `deposit_failed` samples in admin-front.

## Verification

- `python -m pytest tests/test_analytics_dashboard_repository.py -q`
- `yarn test src/features/dashboard/analytics-presenters.test.ts`
- `yarn build`
- Browser screenshots:
  - `output/analytics-drilldown/01-overview-budget-alert.png`
  - `output/analytics-drilldown/02-risk-budget-blocks.png`
  - `output/analytics-drilldown/03-provider-available-to-withdraw.png`
  - `output/analytics-drilldown/04-money-flow-failed-deposits.png`
