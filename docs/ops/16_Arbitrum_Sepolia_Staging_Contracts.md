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
5. Deployment evidence proves addresses, bytecode, constructor args, explorer
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
export ARBISCAN_API_KEY="..." # Etherscan API V2 key; legacy env name kept for compatibility.
export STAGING_TEST_CONSUMER_ADDRESS="0x..."
export STAGING_TEST_PROVIDER_ADDRESS="0x..."
```

The full staging configuration matrix, including where each value lives in
Secret Manager or Cloud Run, is maintained in
`docs/ops/17_Staging_Environment_Configuration.md`.

## Current Verified Staging Deployment

The canonical Arbitrum Sepolia staging deployment is:

| Item | Value |
| --- | --- |
| Evidence directory | `docs/evidence/release/contracts/arbitrum-sepolia/20260424T062942120Z-deploy/` |
| Chain | Arbitrum Sepolia (`421614`) |
| SynapseCore / `ROUTER_ADDRESS` | `0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4` |
| MockUSDC / `USDC_TOKEN_ADDRESS` | `0xfad31daE42B0046aFA106BCf56ED0dDaCA4463B9` |
| Contract owner | `0x1896285a84ED0aa7C654B2547b3dDF137B974cCE` |
| Gateway withdraw signer | `0x1Eb2A684B8B7160D947940b644be6f939C783963` |
| MockUSDC explorer | `https://sepolia.arbiscan.io/address/0xfad31daE42B0046aFA106BCf56ED0dDaCA4463B9#code` |
| SynapseCore explorer | `https://sepolia.arbiscan.io/address/0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4#code` |

Staging uses owner-only `MockUSDC`. The deployment script pre-minted
`100,000 MockUSDC` each to the dedicated staging consumer and provider E2E
wallets.

Those dedicated staging E2E wallets are mutable after deployment: dogfood and
release E2E runs intentionally spend MockUSDC. The contract evidence gate proves
the deployment-time mint transactions and recorded pre-mint balances. A current
wallet balance below the original pre-mint amount is a warning unless
`CONTRACT_EVIDENCE_REQUIRE_CURRENT_PREMINT_BALANCE=1` is explicitly set for a
top-up audit.

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

For repeated staging work, use the wallet utility before dry-run or deploy:

```bash
npm run staging:arb-sepolia:wallets:status
```

If `services/gateway/.env.staging` still contains placeholder text instead of
real secrets, export the live deployment values into your current shell first:

```bash
export ARBITRUM_SEPOLIA_RPC_URL="$(gcloud secrets versions access latest \
  --secret=synapse-staging-arbitrum-sepolia-rpc-url \
  --project=fabled-archive-494108-k5)"
export STAGING_DEPLOYER_PRIVATE_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-deployer-private-key \
  --project=fabled-archive-494108-k5)"
export ARBISCAN_API_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-arbiscan-api-key \
  --project=fabled-archive-494108-k5)"
```

Then make sure the non-secret addresses are also present in your shell or local
untracked `services/gateway/.env.staging`:

```bash
export STAGING_CONTRACT_OWNER_ADDRESS="0x..."
export STAGING_WITHDRAW_SIGNER_ADDRESS="0x..."
export STAGING_TEST_CONSUMER_ADDRESS="0x..."
export STAGING_TEST_PROVIDER_ADDRESS="0x..."
```

This checks:

1. RPC really resolves to Arbitrum Sepolia (`chainId=421614`).
2. Gas funder, deployer, consumer, and provider wallet balances when the gas
   funder key is available locally or via Secret Manager.
3. Whether each wallet meets `STAGING_MIN_GAS_ETH`.

If any tracked wallet is below `STAGING_MIN_GAS_ETH`, the status command exits
non-zero on purpose. That makes it safe to wire into shell preflight or future
CI evidence checks. In `--status` mode, low funder balance is shown but does
not fail the command unless you are in `--fund` mode.

If you want to automatically top up those wallets from a separate funded staging
wallet, either export an additional local-only variable or upload the key to
GCP Secret Manager:

```bash
export STAGING_GAS_FUNDER_PRIVATE_KEY="0x..."
export STAGING_FUND_TARGET_GAS_ETH="0.02"
npm run staging:arb-sepolia:wallets:fund
```

Or store it in Secret Manager and let the script read it automatically:

```bash
printf '%s' '0x...' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-gas-funder-private-key

export PROJECT_ID="fabled-archive-494108-k5"
export STAGING_GAS_FUNDER_SECRET_ID="synapse-staging-gas-funder-private-key"
export STAGING_FUND_TARGET_GAS_ETH="0.02"
npm run staging:arb-sepolia:wallets:fund
```

`STAGING_GAS_FUNDER_PRIVATE_KEY` and `synapse-staging-gas-funder-private-key`
are intentionally operator-only. Do not wire either into Cloud Run runtime,
Terraform variables carrying values, or repo-tracked env files. Use a temporary
funded staging wallet or owner-controlled staging wallet for top-ups.

## Faucet and Bridge Workflow

The staging wallet utility only works after at least one wallet already has
real `Arbitrum Sepolia ETH`. There are two supported ways to get the first gas.

### Route A: Direct Arbitrum Sepolia faucet

Try a direct `Arbitrum Sepolia` faucet first. Common operator choices:

1. Alchemy Arbitrum Sepolia faucet
2. Chainlink faucet
3. ETHGlobal faucet

Notes:

1. Some faucets require Ethereum Mainnet balance and enough mainnet activity.
2. A wallet can qualify for faucet access and still show `0 ETH` on Arbitrum
   Sepolia until the faucet really sends the test ETH.
3. What matters for deployment is the `Arbitrum Sepolia` balance, not Ethereum
   Mainnet balance and not Ethereum Sepolia balance.

### Route B: Ethereum Sepolia faucet, then bridge to Arbitrum Sepolia

If a direct Arbitrum Sepolia faucet is blocked:

1. Claim `Ethereum Sepolia ETH` to the gas funder wallet.
2. Open the official bridge: `https://bridge.arbitrum.io/`
3. Connect the same wallet.
4. Set:
   - From: `Ethereum Sepolia`
   - To: `Arbitrum Sepolia`
5. Bridge about `0.06 - 0.08 ETH` so there is enough to fund deployer,
   consumer, and provider.

### Important network distinction

The same EVM wallet address exists on multiple chains, but balances are
separate:

1. `Ethereum Mainnet ETH` is only faucet eligibility proof for some providers.
2. `Ethereum Sepolia ETH` is L1 testnet ETH.
3. `Arbitrum Sepolia ETH` is the actual gas used by staging deployment and
   wallet top-up scripts.

Receiving `Ethereum Sepolia ETH` does not automatically make the same address
have ETH on `Arbitrum Sepolia`. That requires a bridge.

## Retryable Ticket Check After Bridging

When bridging from `Ethereum Sepolia` to `Arbitrum Sepolia`, the L1
transaction goes to the Arbitrum Inbox contract, not directly to the final
wallet address. That is expected.

If the bridge transaction is successful on `Ethereum Sepolia` but the wallet
still shows `0 ETH` on `Arbitrum Sepolia`:

1. Open `https://retryable-dashboard.arbitrum.io/`
2. Connect the same gas funder wallet
3. Find the retryable ticket created by the bridge transaction
4. Check whether the ticket is:
   - `redeemed`
   - `redeemable`
   - `failed`
5. If it is redeemable but not redeemed, manually redeem it

After redeem succeeds, rerun:

```bash
npm run staging:arb-sepolia:wallets:status
```

## Distributing Gas To Other Wallets

Once the gas funder wallet has a non-zero `Arbitrum Sepolia ETH` balance, use
the wallet utility to distribute gas to the three deployment wallets:

1. `deployer`
2. `consumer`
3. `provider`

Typical flow:

```bash
npm run staging:arb-sepolia:wallets:status
npm run staging:arb-sepolia:wallets:fund
npm run staging:arb-sepolia:wallets:status
```

The funding script only sends the missing delta required to bring each wallet
up to `STAGING_FUND_TARGET_GAS_ETH`.

## Deployment Flow

0. Optional wallet preflight / top-up:

```bash
npm run staging:arb-sepolia:wallets:status
# If any wallet is below threshold:
export PROJECT_ID="fabled-archive-494108-k5"
export STAGING_GAS_FUNDER_SECRET_ID="synapse-staging-gas-funder-private-key"
npm run staging:arb-sepolia:wallets:fund
```

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
10. Waits before explorer verification to avoid explorer indexing races.
11. Retries verification with bounded attempts.
12. Writes evidence.

## Verification Recovery

If deployment succeeds but source verification fails because the explorer API is
temporarily unavailable or rejects a deprecated endpoint, do not redeploy.
Redeploying burns gas and creates unnecessary duplicate staging contracts.

Use the existing deployment evidence directory and rerun verification only:

```bash
export ARBITRUM_SEPOLIA_RPC_URL="$(gcloud secrets versions access latest \
  --secret=synapse-staging-arbitrum-sepolia-rpc-url \
  --project=fabled-archive-494108-k5)"
export ARBISCAN_API_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-arbiscan-api-key \
  --project=fabled-archive-494108-k5)"

CONTRACT_DEPLOYMENT_EVIDENCE_DIR=docs/evidence/release/contracts/arbitrum-sepolia/<timestamp>-deploy \
  npm run verify:contracts:arbitrum-sepolia:evidence
```

`synapse-staging-arbiscan-api-key` now stores an Etherscan API V2-compatible
key. The old Secret Manager id is kept so existing scripts and docs do not
need a disruptive rename.

If verification returns `Invalid API Key (#err2)`, replace the secret value with
an Etherscan API V2 key from `https://etherscan.io/myapikey`. Old Arbiscan
network-specific keys are rejected by the V2 endpoint:

```bash
printf '%s' '<etherscan-api-v2-key>' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-arbiscan-api-key
```

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
8. Explorer verification is `success` or `already_verified`.
9. Deployer, owner, and withdraw signer are separate addresses.
10. Deployer, consumer, and provider gas preflight passed.
11. Consumer/provider pre-mint balances are recorded in deployment evidence;
    current balances are allowed to be lower after staging dogfood spends
    MockUSDC.
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
6. Do not store `STAGING_GAS_FUNDER_PRIVATE_KEY` in Cloud Run runtime, shared
   `.env` files committed to git, or Secret Manager placeholders used by
   runtime services.
