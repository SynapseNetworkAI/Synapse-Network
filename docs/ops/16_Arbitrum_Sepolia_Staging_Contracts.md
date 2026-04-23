---
title: Arbitrum Sepolia Staging Contracts
status: active
owner: ops
last_reviewed: 2026-04-22
---

# Arbitrum Sepolia Staging Contracts

This document defines how Synapse connects staging to Arbitrum Sepolia
(`chainId=421614`) and how contract deployment evidence is produced. Staging
uses a self-deployed owner-only `MockUSDC`, not official USDC and not production
USDC.

## Goal

Staging must exercise the same chain boundary as production-like flows:

1. Gateway reads Arbitrum Sepolia blocks.
2. User-front points at the deployed `SynapseCore`.
3. `SynapseCore` verifies EIP-712 withdrawal tickets with `chainId=421614`.
4. Dedicated staging consumer/provider wallets use preallocated `MockUSDC`.
5. Deployment evidence proves addresses, bytecode, constructor args, Arbiscan
   verification, wallet gas preflight, and pre-mint balances.

Local `31337` evidence remains useful for rehearsal, but it does not close the
staging-chain blocker.

## Required Environment

These variables are required for deployment dry-run and deployment:

```bash
export ARBITRUM_SEPOLIA_RPC_URL="https://arb-sepolia.g.alchemy.com/v2/..."
export STAGING_DEPLOYER_PRIVATE_KEY="0x..."
export STAGING_CONTRACT_OWNER_ADDRESS="0x..."
export STAGING_WITHDRAW_SIGNER_ADDRESS="0x..."
export ARBISCAN_API_KEY="..."
export STAGING_TEST_CONSUMER_ADDRESS="0x..."
export STAGING_TEST_PROVIDER_ADDRESS="0x..."
```

The full staging configuration matrix, including where each value lives in
Secret Manager or Cloud Run, is maintained in
`docs/ops/17_Staging_Environment_Configuration.md`.

Role separation is mandatory:

1. `STAGING_DEPLOYER_PRIVATE_KEY`: deploys contracts, pre-mints MockUSDC, then
   transfers MockUSDC ownership.
2. `STAGING_CONTRACT_OWNER_ADDRESS`: final owner for `MockUSDC` and
   `SynapseCore`.
3. `STAGING_WITHDRAW_SIGNER_ADDRESS`: Gateway withdrawal signer address.
4. `STAGING_TEST_CONSUMER_ADDRESS`: dedicated staging E2E consumer wallet.
5. `STAGING_TEST_PROVIDER_ADDRESS`: dedicated staging E2E provider wallet.

Dry-run requires deployer, consumer, and provider wallets to each have at least
`0.01` Arbitrum Sepolia ETH for gas.

## Deployment Flow

1. Run dry-run:

```bash
npm run deploy:contracts:arbitrum-sepolia:dry-run
```

2. Deploy:

```bash
npm run deploy:contracts:arbitrum-sepolia
```

The deployment script:

1. Compiles contracts.
2. Verifies RPC `chainId === 421614`.
3. Checks deployer/consumer/provider gas balances.
4. Deploys `MockUSDC` with deployer as temporary owner.
5. Pre-mints `100,000 MockUSDC` to the consumer test wallet.
6. Pre-mints `100,000 MockUSDC` to the provider test wallet.
7. Transfers `MockUSDC` ownership to `STAGING_CONTRACT_OWNER_ADDRESS`.
8. Deploys `SynapseCore(MockUSDC, withdrawSigner, owner)`.
9. Waits for deployment confirmations.
10. Waits before Arbiscan verification to avoid explorer indexing races.
11. Retries verification with bounded attempts.
12. Writes evidence.

## Evidence Output

Evidence is written to:

```text
docs/evidence/release/contracts/arbitrum-sepolia/<timestamp>-deploy/
```

Required files:

1. `contract-manifest.json`
2. `deployment-txs.json`
3. `verification.json`
4. `wallet-preflight.json`
5. `report.json`
6. `report.md`

Evidence must not contain private keys, RPC API keys, raw signatures, JWTs,
admin tokens, or Lark/Gmail secrets.

## Evidence Gate

Run:

```bash
npm run ci:contract-deployment-evidence
```

The gate validates:

1. `chainId === 421614`.
2. `MockUSDC` and `SynapseCore` addresses are non-zero.
3. Chain bytecode exists at both addresses.
4. On-chain deployed code hash matches `contract-manifest.json`.
5. ABI and bytecode hashes match local compiled artifacts.
6. Constructor args hash can be recomputed.
7. Deployment tx hashes and block numbers exist.
8. Arbiscan verification is `success` or `already_verified`.
9. Deployer, owner, and withdraw signer are separate addresses.
10. Deployer, consumer, and provider gas preflight passed.
11. Consumer/provider pre-mint balances are present on-chain.
12. Evidence does not leak secrets.

This gate needs `ARBITRUM_SEPOLIA_RPC_URL` so it can read live bytecode and
contract state.

## Staging Runtime Injection

After evidence passes, set staging runtime env:

```bash
RPC_URL="$ARBITRUM_SEPOLIA_RPC_URL"
ROUTER_ADDRESS="<SynapseCore from contract-manifest.json>"
USDC_TOKEN_ADDRESS="<MockUSDC from contract-manifest.json>"
PRIVATE_KEY="<private key whose address is STAGING_WITHDRAW_SIGNER_ADDRESS>"
```

User-front staging config should use the same manifest addresses:

```json
{
  "chainId": 421614,
  "chainName": "Arbitrum Sepolia",
  "explorer": "https://sepolia.arbiscan.io",
  "MockUSDC": "0x...",
  "SynapseCore": "0x..."
}
```

## Staging Full-Chain Smoke

After runtime injection:

1. Gateway readiness can read Arbitrum Sepolia latest block.
2. Gateway contract code hash matches the deployment manifest.
3. Consumer wallet can approve and deposit preallocated `MockUSDC`.
4. Gateway deposit confirm writes ledger state.
5. Provider/consumer withdrawal tickets use `chainId=421614` and the deployed
   `SynapseCore` address.
6. Valid claim succeeds.
7. Replay is rejected.
8. Ledger/vault reconciliation unexplained delta is `0.000000`.

## Hard Boundaries

1. Staging chain is Arbitrum Sepolia only.
2. Staging token is owner-only `MockUSDC`.
3. Staging evidence does not close production Arbitrum One release evidence.
4. Production still needs its own deployment manifest, small-value rehearsal,
   owner sign-off, and monitoring/reconciliation evidence.
5. Do not run staging deploy scripts with production keys or production RPC.
