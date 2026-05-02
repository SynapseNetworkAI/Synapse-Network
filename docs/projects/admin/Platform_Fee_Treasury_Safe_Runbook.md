# Platform Fee Treasury Safe Runbook

## V1 Custody Model

V1 uses a `1-of-1` Safe Treasury. The only Safe owner is the Ledger hardware wallet address. `SynapseCore.owner()` must be the Safe address, so `withdrawPlatformFees(uint256)` can only be executed by Safe and accrued USDC platform fees land in Safe.

This is intentional for solo operation: Gateway/Admin code stays Safe-compatible, but daily execution requires only one Ledger confirmation. When the team expands, upgrade the same Safe to `2-of-3` or `3-of-5` with Safe native owner management.

## Admin Flow

1. A `super_admin` opens Finance -> `Withdraw platform fees`. This action is a modal/popup workflow, not a sidebar page.
2. Admin enters `amountUsdc` and a reason.
3. `gateway-admin` requires admin session, CSRF, Google Authenticator step-up, and the `super_admin` role.
4. `gateway-admin` reads `SynapseCore.owner()` and `platformFeePool()` from RPC.
5. `gateway-admin` verifies owner equals `PLATFORM_TREASURY_SAFE_ADDRESS`.
6. `gateway-admin` builds a Safe transaction draft with:
   - `to = SYNAPSE_CORE_ADDRESS`
   - `value = 0`
   - `operation = 0`
   - `data = withdrawPlatformFees(uint256)` calldata
7. Admin copies/imports the draft into Safe UI.
8. Ledger signs and executes the Safe transaction.
9. Operator records Safe tx hash, chain tx hash, and before/after treasury evidence.

## Hard Guardrails

- Do not let the frontend provide `to`, `data`, `functionName`, `recipient`, or `value`.
- Do not expose platform fee withdrawal as primary sidebar navigation. It must stay as a Finance-page super-admin modal action.
- Do not allow finance reviewers or platform ops admins to create drafts even if they hold `approval:decide`.
- The backend must hardcode selector `0x6aa21416`, which is `withdrawPlatformFees(uint256)`.
- Draft creation fails if `amountAtomic > SynapseCore.platformFeePool()`.
- Draft creation fails if `SynapseCore.owner()` is not the configured Safe.
- Duplicate request ids must be rejected after a successful draft audit.
- Gateway-admin never broadcasts the transaction.

## Required Environment

```dotenv
RPC_URL=<chain RPC>
SYNAPSE_CORE_ADDRESS=<SynapseCore>
PLATFORM_TREASURY_SAFE_ADDRESS=<Safe>
PLATFORM_TREASURY_LEDGER_SIGNER_ADDRESS=<Ledger signer>
PLATFORM_FEE_TOKEN_DECIMALS=18 # local/staging MockUSDC, use 6 for real USDC deployments
```

## Evidence

Each withdrawal should preserve:

- request id
- amount USDC and atomic amount
- Safe address
- Ledger signer address
- selector
- calldata hash
- reviewer and reason
- Safe tx hash and chain tx hash after manual execution
- before/after `platformFeePool`
- before/after Safe USDC balance
