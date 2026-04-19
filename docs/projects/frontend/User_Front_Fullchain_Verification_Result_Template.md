# User Front Fullchain Verification Result Template

- Status: supplementary
- Scope: `http://localhost:3000` user-front fullchain page verification
- Related runbook: `docs/projects/frontend/User_Front_Page_Verification_Runbook.md`
- Seed script: `scripts/e2e/user_front_fullchain_seed.mjs`
- Browser script: `scripts/ui/verify_user_front_pages.mjs`

## Run Metadata

- Run ID:
- Commit:
- Operator:
- Started at:
- Finished at:
- Base URL:
- Gateway URL:
- RPC URL:
- Chain ID:
- Fixture path:
- Report path:

## Seed Evidence

- Consumer address:
- Provider address:
- Mock upstream URLs:
- Mock upstream PIDs:
- SynapseCore address:
- MockUSDC address:
- Deposit amount:
- Deposit tx hash:
- Deposit intent ID:
- Service IDs:
- Service prices:
- Credential ID:
- Credential calls used:
- Invocation count:
- Invocation distribution:
- First invocation ID:
- Last invocation ID:
- First request ID:
- Last request ID:
- Total consumer charge:
- Total platform fee:
- Total provider net:
- Consumer balance after invoke:
- Provider receivable after invoke:
- Provider withdrawal capability status:

## Browser Result

- Passed:
- Failed:
- Blocked:
- Warnings:
- Console errors:

## Required Screenshots

- Home:
- Marketplace:
- Dashboard overview:
- Credits:
- Payments:
- Credentials:
- Invocations:
- Provider console:
- Provider services:
- Provider health:
- Provider withdraw:

## Reconciliation

- Marketplace registry includes seeded service:
- Marketplace registry includes three seeded services:
- Consumer balance decreased by receipt-summed total charge:
- Credits page displays the final consumer balance:
- Agents page shows seeded credential and 100 calls used:
- Credentials page shows seeded credential prefix/status/calls:
- Invocations page shows seeded usage rows:
- Provider earnings includes receipt-summed provider net:
- Provider service list includes three seeded services:
- Provider health shows callable targets:
- Provider usage/history shows seeded usage rows:
- Provider withdraw page reads withdrawal capability:

## Bugs Found

| Bug | Area | Status | Fix commit | Verification |
| --- | --- | --- | --- | --- |
| None | | | | |

## Decision

- `PASS`: only if `failed=0`, `blocked=0`, required screenshots exist, and seed reconciliation is complete.
- `FAIL`: any failed browser assertion, missing screenshot, missing seed evidence, missing real backend response for read-data pages, or unresolved P0/P1 visual/data bug.
