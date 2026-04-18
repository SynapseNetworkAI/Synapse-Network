# BUG-GOLIVE-02 - contracts gate had no Hardhat invariant tests

## Reproduction

Run:

```bash
npm run ci:contracts
```

Before this fix, the command only compiled contracts and printed:

```text
[ci:contracts] no root hardhat tests found, compile gate only
```

That meant the repository-local release gate could not verify core `SynapseCore` custody invariants such as nonce replay rejection, deadline enforcement, signer authorization, amount/fee tamper rejection, platform fee bounds, or owner-only signer rotation.

## Root Cause

The root `test/` directory did not exist, so `scripts/ci/contracts_checks.sh` intentionally skipped `npx hardhat test`.

## Fix

Added `test/SynapseCore.security.test.js` covering:

1. deployment rejects zero custody/signer addresses
2. deposits transfer USDC and emit `DepositInfo`
3. valid EIP-712 withdrawal executes once
4. nonce replay is rejected
5. expired, wrong-signer, wrong-nonce, and tampered amount/fee tickets are rejected
6. platform fee withdrawals are limited to accrued fees
7. signer rotation is owner-only and rejects zero signer

## Verification

```bash
npm run ci:contracts
```

Result:

```text
7 passing
```

## Residual Risk

These are local Hardhat invariant tests. They do not replace third-party audit, fork tests, production deployment dry-run, source verification, multisig/signer proof, or real-chain small-value rehearsal.
