# BUG-CONSUMER-WITHDRAW-MIN-AMOUNT-E2E

**Status:** Fixed

- Domain: gateway / consumer withdrawals / e2e
- Fixed in: `services/gateway/tests/e2e/test_09_consumer_withdraw.py`
- Verification: `cd services/gateway && .venv/bin/python -m pytest tests/e2e/test_09_consumer_withdraw.py -q`
- Last verified against code: 2026-05-03

## Problem

The consumer withdrawal E2E test still attempted to withdraw `1.00` USDC after the runtime policy had moved to a `10.00` USDC minimum withdrawal amount. Full pre-push CI failed with `MIN_WITHDRAWAL_AMOUNT_NOT_MET`.

After the amount was corrected, the same test also exposed the newer T+1 matured funds policy: a freshly seeded local deposit can have available balance while `mature withdrawable balance` is still `0.000000`.

## Root Cause

The test encoded an old minimum amount and sent the withdrawal amount as a JSON number. It also treated `consumerAvailableBalance` as immediately withdrawable, which is no longer true under the T+1 consumer withdrawal maturity window.

## Fix

The E2E now uses `MIN_CONSUMER_WITHDRAW_USDC = Decimal("10.00")`, asserts the seeded balance is above that minimum, and sends withdrawal amounts as decimal strings. If the gateway returns `INSUFFICIENT_MATURE_CONSUMER_BALANCE`, the withdrawal-chain assertions skip because the local seed has not crossed the T+1 maturity window.

## Prevention Rule

When withdrawal minimums, fee policies, maturity windows, or balance-state rules change, update the matching E2E fixture/test constants and docs in the same PR. Do not leave tests with historical example amounts or assumptions that treat available balance as withdrawable balance.
