# BUG-FRONT-FULLCHAIN-02 Funds Page Called Missing SynapseCore balanceOf

**Status:** Fixed

## Reproduction

1. Run `npm run e2e:user-front-fullchain:seed`.
2. Run `npm run e2e:user-front-fullchain:verify`.
3. Open `/dashboard/billing` or any page using `useFundsData`.

## Expected

The funds hook reads wallet and vault balances without browser console errors.

## Actual

The browser reported `TypeError: vault.balanceOf is not a function`.

## Root Cause

`SynapseCore` is a vault/router contract and does not expose ERC-20 `balanceOf`. The hook incorrectly attempted to call `balanceOf(userAddress)` on `SynapseCore`.

## Fix

Read the total vault token balance with `MockUSDC.balanceOf(SynapseCore)` and keep user wallet balance on `MockUSDC.balanceOf(userAddress)`.

## Verification

- `npm run e2e:user-front-fullchain:verify`

## Residual Risk

This displays total on-chain vault token balance, not a per-user off-chain available balance. Per-user funds remain sourced from gateway balance APIs.
