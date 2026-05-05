#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { ethers } from "ethers";

const LOCAL_CHAIN_IDS = new Set([31337n, 1337n]);
const DEFAULT_LOCAL_DEPLOYER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function printUsage() {
  console.log(`Usage:
  node scripts/local/top_up_local_vault_liquidity.mjs <amountUsdc> [--dry-run]

Examples:
  node scripts/local/top_up_local_vault_liquidity.mjs 500 --dry-run
  node scripts/local/top_up_local_vault_liquidity.mjs 500

Environment:
  RPC_URL                     Defaults to http://127.0.0.1:8545
  LOCAL_DEPLOYER_PRIVATE_KEY  Defaults to Hardhat account #0

Safety:
  This script only runs against local Hardhat/Anvil chain IDs 31337 or 1337.
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  return {
    amount: positional[0] || "500",
    dryRun,
    help: false,
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function requireLocalChain(provider) {
  const network = await provider.getNetwork();
  if (!LOCAL_CHAIN_IDS.has(network.chainId)) {
    throw new Error(
      `Refusing to mint vault liquidity on non-local chainId=${network.chainId}. ` +
        "Use this script only with local Hardhat/Anvil."
    );
  }
  return network;
}

async function requireContractCode(provider, address, label) {
  const code = await provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error(
      `${label} has no bytecode at ${address}. Check contract-config.json.`
    );
  }
}

function parsePositiveAmount(amount, decimals) {
  const normalized = String(amount || "").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("amountUsdc must be a positive decimal string.");
  }
  const atomic = ethers.parseUnits(normalized, decimals);
  if (atomic <= 0n) {
    throw new Error("amountUsdc must be greater than 0.");
  }
  return atomic;
}

async function main() {
  const { amount, dryRun, help } = parseArgs(process.argv);
  if (help) {
    printUsage();
    return;
  }

  const root = process.cwd();
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const deployerKey =
    process.env.LOCAL_DEPLOYER_PRIVATE_KEY ||
    DEFAULT_LOCAL_DEPLOYER_PRIVATE_KEY;
  const contractConfigPath = path.join(
    root,
    "services/user-front/src/contract-config.json"
  );
  const mockUsdcAbiPath = path.join(
    root,
    "services/user-front/src/MockUSDCABI.json"
  );
  const config = readJson(contractConfigPath);
  const usdcAbi = readJson(mockUsdcAbiPath);
  const mockUsdcAddress = ethers.getAddress(config.MockUSDC);
  const synapseCoreAddress = ethers.getAddress(config.SynapseCore);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await requireLocalChain(provider);
  await requireContractCode(provider, mockUsdcAddress, "MockUSDC");
  await requireContractCode(provider, synapseCoreAddress, "SynapseCore");

  const signer = new ethers.Wallet(deployerKey, provider);
  const usdc = new ethers.Contract(mockUsdcAddress, usdcAbi, signer);
  const decimals = await usdc.decimals().catch(() => 18n);
  const amountAtomic = parsePositiveAmount(amount, decimals);
  const before = await usdc.balanceOf(synapseCoreAddress);

  console.log(`RPC: ${rpcUrl}`);
  console.log(`chainId: ${network.chainId}`);
  console.log(`MockUSDC: ${mockUsdcAddress}`);
  console.log(`SynapseCore: ${synapseCoreAddress}`);
  console.log(`Vault before: ${ethers.formatUnits(before, decimals)} USDC`);
  console.log(
    `Top-up amount: ${ethers.formatUnits(amountAtomic, decimals)} USDC`
  );

  if (dryRun) {
    console.log("Dry run: no mint transaction sent.");
    return;
  }

  const tx = await usdc.mint(synapseCoreAddress, amountAtomic);
  console.log(`Mint tx: ${tx.hash}`);
  await tx.wait();

  const after = await usdc.balanceOf(synapseCoreAddress);
  console.log(`Vault after: ${ethers.formatUnits(after, decimals)} USDC`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
