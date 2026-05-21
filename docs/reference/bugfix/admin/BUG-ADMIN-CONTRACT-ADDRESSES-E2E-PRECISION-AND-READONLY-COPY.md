# BUG-ADMIN-CONTRACT-ADDRESSES-E2E-PRECISION-AND-READONLY-COPY

## Symptom

The local Contract / Address management E2E failed the API-to-SQL evidence check because `ledgerPlatformFeeUsdc` was returned as a rounded dashboard value while the SQL evidence used the six-decimal finance projection. The same run also flagged read-only boundary copy containing mutation-oriented phrases such as `Change owner` and `Broadcast`.

## Root Cause

`ContractAddressRegistryService` reused `DashboardService.get_finance_overview()`, which intentionally formats money values for dashboard cards. The contract-address page is an evidence and reconciliation surface, so it must use precise Postgres projection decimals. The read-only boundary copy was descriptive, but it still contained words that look like possible on-chain operations.

## Fix

- Read precise finance and reconciliation values from the gateway dashboard projection repository when building the contract-address registry response.
- Keep the existing dashboard data as a fallback only.
- Rewrite the read-only boundary copy to avoid mutation verbs and clarify that address updates and on-chain execution stay in Terraform, Safe, Ledger, and runbook workflows.

## Verification

```bash
cd services/gateway-admin && .venv/bin/python -m pytest tests/test_contract_address_registry.py -q
cd services/admin-front && yarn test src/features/contract-addresses/contract-addresses-page.test.tsx
ADMIN_FRONT_URL=http://127.0.0.1:3200 ADMIN_GATEWAY_URL=http://127.0.0.1:8300 npm run e2e:admin-contract-addresses-readonly
npm run ci:admin-contract-addresses-evidence
```

## Status

fixed
