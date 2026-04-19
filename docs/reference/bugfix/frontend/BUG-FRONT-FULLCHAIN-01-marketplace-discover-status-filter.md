# BUG-FRONT-FULLCHAIN-01 Marketplace Registry Filtered Callable Services

**Status:** Fixed

## Reproduction

1. Start local gateway, chain, and user-front.
2. Run `npm run e2e:user-front-fullchain:seed`.
3. Fetch gateway discovery directly:
   `GET http://127.0.0.1:8000/api/v1/services/discover?q=<seeded-service-id>`.
4. Fetch user-front registry:
   `GET http://127.0.0.1:3000/marketplace/registry.json?page=1&pageSize=10`.

## Expected

The user-front registry returns the seeded callable service because gateway discovery marks it healthy and runtime-available.

## Actual

The user-front registry returned `total=0` even though gateway discovery returned the seeded service.

## Root Cause

`services/user-front/src/utils/serviceApi.ts` normalized `isActive` as `raw.status === "active"` when `raw.isActive` was not present. Gateway public discovery returns runtime status values such as `healthy`, so callable records were incorrectly treated as inactive and filtered out by `/marketplace/registry.json`.

## Fix

Normalize missing `isActive` as false only for explicit control-plane inactive statuses (`inactive`, `archived`, `deleted`, `paused`) and read `runtimeAvailable` from `runtimeAvailable`, `serviceHealth.runtimeAvailable`, or `health.runtimeAvailable`.

## Verification

- `npm run e2e:user-front-fullchain:seed`
- `npm run e2e:user-front-fullchain:verify`

## Residual Risk

If gateway introduces additional explicit non-callable control-plane statuses, the user-front denylist should be updated alongside the service contract.
