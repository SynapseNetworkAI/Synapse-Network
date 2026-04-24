const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ethers } = require("ethers");

const CHAIN_ID = 421614n;
const CHAIN_NAME = "Arbitrum Sepolia";
const DEFAULT_MIN_GAS_ETH = "0.01";
const DEFAULT_TARGET_GAS_ETH = "0.02";

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env ${name}`);
  }
  return value.trim();
}

function applyEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function resolveEnvCandidates() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const explicit = (process.env.ENV_FILE || "").trim();
  const candidates = [];

  if (explicit) {
    candidates.push(
      path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit),
      path.resolve(repoRoot, "services", "gateway", explicit),
    );
  }

  candidates.push(
    path.resolve(repoRoot, ".env.staging"),
    path.resolve(repoRoot, "services", "gateway", ".env.staging"),
    path.resolve(repoRoot, ".env"),
    path.resolve(repoRoot, "services", "gateway", ".env"),
  );

  return [...new Set(candidates)];
}

for (const candidate of resolveEnvCandidates()) {
  applyEnvFile(candidate);
}

const provider = new ethers.JsonRpcProvider(requireEnv("ARBITRUM_SEPOLIA_RPC_URL"));

function optionalEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    return "";
  }
  return value.trim();
}

function requireAddress(name) {
  const value = requireEnv(name);
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${name} must be a non-zero Ethereum address`);
  }
  return ethers.getAddress(value);
}

function requirePrivateKey(name) {
  const value = requireEnv(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 0x-prefixed 32-byte private key`);
  }
  return value;
}

function resolveProjectId() {
  const explicit =
    optionalEnv("PROJECT_ID") ||
    optionalEnv("GOOGLE_CLOUD_PROJECT") ||
    optionalEnv("CLOUDSDK_CORE_PROJECT");
  if (explicit) {
    return explicit;
  }
  try {
    return execFileSync("gcloud", ["config", "get-value", "project"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    return "";
  }
}

function accessSecret(secretId, projectId) {
  try {
    return execFileSync(
      "gcloud",
      ["secrets", "versions", "access", "latest", `--secret=${secretId}`, `--project=${projectId}`],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    const stderr = String(error && error.stderr ? error.stderr : "").trim();
    throw new Error(
      `Unable to read Secret Manager secret ${secretId} in project ${projectId}. ${stderr || "Check gcloud auth and secret placeholder."}`,
    );
  }
}

function resolveFunderPrivateKey({ required }) {
  const inline = optionalEnv("STAGING_GAS_FUNDER_PRIVATE_KEY");
  if (inline) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(inline)) {
      throw new Error("STAGING_GAS_FUNDER_PRIVATE_KEY must be a 0x-prefixed 32-byte private key");
    }
    return inline;
  }

  const secretId = optionalEnv("STAGING_GAS_FUNDER_SECRET_ID") || "synapse-staging-gas-funder-private-key";
  const projectId = resolveProjectId();
  if (!projectId) {
    if (!required) {
      return "";
    }
    throw new Error(
      "Missing GCP project context for gas funder secret. Set PROJECT_ID/GOOGLE_CLOUD_PROJECT or run gcloud config set project <project-id>.",
    );
  }
  let secretValue = "";
  try {
    secretValue = accessSecret(secretId, projectId);
  } catch (error) {
    if (!required) {
      return "";
    }
    throw error;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(secretValue)) {
    if (!required && !secretValue) {
      return "";
    }
    throw new Error(
      `Secret Manager value ${secretId} must be a 0x-prefixed 32-byte private key`,
    );
  }
  return secretValue;
}

function parseEth(name, fallback) {
  const raw = optionalEnv(name) || fallback;
  try {
    const value = ethers.parseEther(raw);
    if (value <= 0n) {
      throw new Error("non-positive");
    }
    return { raw, wei: value };
  } catch (error) {
    throw new Error(`${name || "ETH value"} must be a positive decimal ETH amount`);
  }
}

function rpcSummary(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const redactedPath = url.pathname.replace(/\/v2\/[^/]+/i, "/v2/[REDACTED]");
    return `${url.protocol}//${url.host}${redactedPath || "/"}`;
  } catch (error) {
    return "[invalid rpc url]";
  }
}

function includesFlag(flag) {
  return process.argv.includes(flag);
}

function printWallets(wallets, { minGasEth, targetGasEth }) {
  console.log("");
  console.log("Role       Address                                      Balance ETH   Min ETH   Target ETH   Status");
  console.log("---------- -------------------------------------------- ------------ --------- ------------ --------");
  for (const wallet of wallets) {
    const status = wallet.balanceWei >= minGasEth.wei ? "ok" : "low";
    console.log(
      `${wallet.role.padEnd(10)} ${wallet.address} ${wallet.balanceEth.padStart(12)} ${minGasEth.raw.padStart(9)} ${targetGasEth.raw.padStart(12)} ${status.padStart(8)}`,
    );
  }
  console.log("");
}

async function getWallets({ funderAddress, deployerAddress, consumerAddress, providerAddress }) {
  const roles = [
    ...(funderAddress ? [["funder", funderAddress]] : []),
    ["deployer", deployerAddress],
    ["consumer", consumerAddress],
    ["provider", providerAddress],
  ];

  const wallets = [];
  for (const [role, address] of roles) {
    const balanceWei = await provider.getBalance(address);
    wallets.push({
      role,
      address,
      balanceWei,
      balanceEth: ethers.formatEther(balanceWei),
    });
  }
  return wallets;
}

async function verifyChain() {
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(`RPC chainId must be ${CHAIN_ID}, got ${network.chainId}`);
  }
  return network;
}

async function fundWallets({ funderKey, wallets, targetGasEth }) {
  const funder = new ethers.Wallet(funderKey, provider);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits("0.1", "gwei");

  const deficits = wallets
    .map((wallet) => ({
      ...wallet,
      topUpWei: wallet.balanceWei >= targetGasEth.wei ? 0n : targetGasEth.wei - wallet.balanceWei,
    }))
    .filter((wallet) => wallet.topUpWei > 0n);

  if (deficits.length === 0) {
    console.log("All tracked wallets already meet the target gas threshold. No funding transaction needed.");
    return;
  }

  const gasReserveWei = gasPrice * 21000n * BigInt(deficits.length) * 2n;
  const totalTopUpWei = deficits.reduce((sum, wallet) => sum + wallet.topUpWei, 0n);
  const funderBalanceWei = await provider.getBalance(funder.address);

  if (funderBalanceWei < totalTopUpWei + gasReserveWei) {
    throw new Error(
      `STAGING_GAS_FUNDER_PRIVATE_KEY wallet ${funder.address} does not have enough ETH. ` +
        `Need ~${ethers.formatEther(totalTopUpWei + gasReserveWei)} ETH including gas reserve, ` +
        `have ${ethers.formatEther(funderBalanceWei)} ETH.`,
    );
  }

  console.log(`Funding from ${funder.address}`);
  for (const wallet of deficits) {
    console.log(
      `Top up ${wallet.role} ${wallet.address}: +${ethers.formatEther(wallet.topUpWei)} ETH ` +
        `(current ${wallet.balanceEth} ETH -> target ${targetGasEth.raw} ETH)`,
    );
    const tx = await funder.sendTransaction({
      to: wallet.address,
      value: wallet.topUpWei,
    });
    const receipt = await tx.wait();
    console.log(`  tx=${tx.hash} block=${receipt.blockNumber}`);
  }
}

async function main() {
  const fundMode = includesFlag("--fund");
  const jsonMode = includesFlag("--json");

  const rpcUrl = requireEnv("ARBITRUM_SEPOLIA_RPC_URL");
  const deployerKey = requirePrivateKey("STAGING_DEPLOYER_PRIVATE_KEY");
  const consumerAddress = requireAddress("STAGING_TEST_CONSUMER_ADDRESS");
  const providerAddress = requireAddress("STAGING_TEST_PROVIDER_ADDRESS");
  const minGasEth = parseEth("STAGING_MIN_GAS_ETH", DEFAULT_MIN_GAS_ETH);
  const targetGasEth = parseEth("STAGING_FUND_TARGET_GAS_ETH", DEFAULT_TARGET_GAS_ETH);

  if (targetGasEth.wei < minGasEth.wei) {
    throw new Error("STAGING_FUND_TARGET_GAS_ETH must be greater than or equal to STAGING_MIN_GAS_ETH");
  }

  const network = await verifyChain();

  const deployerAddress = new ethers.Wallet(deployerKey).address;
  const funderKey = resolveFunderPrivateKey({ required: fundMode });
  const funderAddress = funderKey ? new ethers.Wallet(funderKey).address : "";
  let wallets = await getWallets({
    funderAddress,
    deployerAddress,
    consumerAddress,
    providerAddress,
  });

  const report = {
    chainId: Number(network.chainId),
    chainName: CHAIN_NAME,
    rpc: rpcSummary(rpcUrl),
    minGasEth: minGasEth.raw,
    targetGasEth: targetGasEth.raw,
    wallets: wallets.map((wallet) => ({
      role: wallet.role,
      address: wallet.address,
      balanceEth: wallet.balanceEth,
      pass: wallet.balanceWei >= minGasEth.wei,
    })),
  };

  console.log(`RPC: ${report.rpc}`);
  console.log(`Chain: ${CHAIN_NAME} (${report.chainId})`);

  if (fundMode) {
    await fundWallets({
      funderKey,
      wallets: wallets.filter((wallet) => wallet.role !== "funder"),
      targetGasEth,
    });
    wallets = await getWallets({
      funderAddress,
      deployerAddress,
      consumerAddress,
      providerAddress,
    });
    report.wallets = wallets.map((wallet) => ({
      role: wallet.role,
      address: wallet.address,
      balanceEth: wallet.balanceEth,
      pass: wallet.balanceWei >= minGasEth.wei,
    }));
  }

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printWallets(wallets, { minGasEth, targetGasEth });
  }

  const failedRoles = new Set(["deployer", "consumer", "provider"]);
  if (fundMode && funderAddress) {
    failedRoles.add("funder");
  }
  const failed = wallets.filter(
    (wallet) => failedRoles.has(wallet.role) && wallet.balanceWei < minGasEth.wei,
  );
  if (failed.length > 0) {
    throw new Error(
      `Wallet gas preflight failed for ${failed.map((wallet) => `${wallet.role}:${wallet.address}`).join(", ")}`,
    );
  }
}

main().catch((error) => {
  console.error(`FATAL STAGING-WALLET-GAS-001: ${String(error && (error.message || error))}`);
  process.exit(1);
});
