#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Contract, JsonRpcProvider, ZeroAddress, getAddress, isAddress, keccak256 } from "ethers";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const EVIDENCE_ROOT = path.join(
  REPO_ROOT,
  "docs",
  "evidence",
  "release",
  "contracts",
  "arbitrum-sepolia",
);
const CHAIN_ID = 421614;
const REQUIRED_FILES = [
  "contract-manifest.json",
  "deployment-txs.json",
  "verification.json",
  "wallet-preflight.json",
  "report.json",
  "report.md",
];
const ERC20_OWNER_ABI = [
  "function owner() view returns (address)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];
const SYNAPSE_CORE_ABI = [
  "function owner() view returns (address)",
  "function platformSigner() view returns (address)",
  "function usdc() view returns (address)",
];

function fail(code, message, fix) {
  console.error(`FATAL ${code}: ${message}`);
  console.error(`Agent fix: ${fix}`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function artifactHash(contractName) {
  const artifactPath = path.join(
    REPO_ROOT,
    "artifacts",
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`,
  );
  if (!fs.existsSync(artifactPath)) {
    fail(
      "CONTRACT-EVIDENCE-ARTIFACT",
      `${artifactPath} is missing.`,
      "run npm run ci:contracts or npx hardhat compile before validating deployment evidence.",
    );
  }
  const artifact = readJson(artifactPath);
  return {
    abiHash: sha256(stableStringify(artifact.abi)),
    bytecodeHash: sha256(artifact.bytecode),
  };
}

function isNonZeroAddress(value) {
  return isAddress(value) && getAddress(value) !== ZeroAddress;
}

function assertAddress(value, label) {
  if (!isNonZeroAddress(value)) {
    fail(
      "CONTRACT-EVIDENCE-ADDRESS",
      `${label} must be a non-zero address.`,
      "rerun npm run deploy:contracts:arbitrum-sepolia with valid staging addresses.",
    );
  }
}

function listCandidateEvidenceDirs() {
  if (process.env.CONTRACT_DEPLOYMENT_EVIDENCE_DIR) {
    return [path.resolve(process.env.CONTRACT_DEPLOYMENT_EVIDENCE_DIR)];
  }
  if (!fs.existsSync(EVIDENCE_ROOT)) {
    return [];
  }
  return fs
    .readdirSync(EVIDENCE_ROOT)
    .map((entry) => path.join(EVIDENCE_ROOT, entry))
    .filter((entryPath) => fs.statSync(entryPath).isDirectory())
    .sort()
    .reverse();
}

function findEvidenceDir() {
  const dirs = listCandidateEvidenceDirs();
  for (const dir of dirs) {
    const reportPath = path.join(dir, "report.json");
    if (!fs.existsSync(reportPath)) {
      continue;
    }
    const report = readJson(reportPath);
    if (process.env.CONTRACT_DEPLOYMENT_EVIDENCE_DIR || report.status === "success") {
      return dir;
    }
  }
  return null;
}

function scanSensitiveKeys(value, location, failures) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanSensitiveKeys(entry, `${location}[${index}]`, failures));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextLocation = `${location}.${key}`;
    if (
      /private|secret|password|authorization|signature|jwt|api.?key|rpc.?url/i.test(key) &&
      child !== undefined &&
      child !== null &&
      String(child).trim() !== "" &&
      String(child) !== "[REDACTED]"
    ) {
      failures.push(`${nextLocation} contains a secret-like key`);
    }
    scanSensitiveKeys(child, nextLocation, failures);
  }
}

function scanEvidenceForSecrets(dir) {
  const failures = [];
  for (const filename of REQUIRED_FILES) {
    const filePath = path.join(dir, filename);
    const text = fs.readFileSync(filePath, "utf8");
    if (/STAGING_DEPLOYER_PRIVATE_KEY|ARBISCAN_API_KEY|Authorization:/i.test(text)) {
      failures.push(`${filename} contains a forbidden secret marker`);
    }
    if (/https:\/\/[^\s"']+\/v2\/[A-Za-z0-9_-]{8,}/.test(text)) {
      failures.push(`${filename} appears to contain an unredacted RPC API key`);
    }
    if (filename.endsWith(".json")) {
      scanSensitiveKeys(JSON.parse(text), filename, failures);
    }
  }
  return failures;
}

function assertDeploymentTx(record, label) {
  if (!record || !/^0x[0-9a-fA-F]{64}$/.test(record.hash || "") || !record.blockNumber) {
    fail(
      "CONTRACT-EVIDENCE-TX",
      `${label} deployment transaction evidence is missing hash or blockNumber.`,
      "rerun the Arbitrum Sepolia deployment script and commit the generated evidence directory.",
    );
  }
  if (record.status !== 1) {
    fail(
      "CONTRACT-EVIDENCE-TX",
      `${label} transaction did not succeed.`,
      "inspect the failed deployment transaction, fix the deployment script or environment, and redeploy.",
    );
  }
}

function assertVerification(verification) {
  const contracts = verification.contracts || [];
  for (const name of ["MockUSDC", "SynapseCore"]) {
    const result = contracts.find((entry) => entry.contractName === name);
    if (!result || !["success", "already_verified"].includes(result.status)) {
      fail(
        "CONTRACT-EVIDENCE-VERIFY",
        `${name} Arbiscan verification is missing or failed.`,
        "rerun npm run deploy:contracts:arbitrum-sepolia after Arbiscan has indexed the deployment.",
      );
    }
  }
}

async function main() {
  const evidenceDir = findEvidenceDir();
  if (!evidenceDir) {
    fail(
      "CONTRACT-EVIDENCE-MISSING",
      "No successful Arbitrum Sepolia contract deployment evidence directory was found.",
      "run npm run deploy:contracts:arbitrum-sepolia and then rerun npm run ci:contract-deployment-evidence.",
    );
  }

  for (const filename of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(evidenceDir, filename))) {
      fail(
        "CONTRACT-EVIDENCE-FILE",
        `${filename} is missing from ${evidenceDir}.`,
        "rerun npm run deploy:contracts:arbitrum-sepolia so all required evidence artifacts are regenerated.",
      );
    }
  }

  const manifest = readJson(path.join(evidenceDir, "contract-manifest.json"));
  const deploymentTxs = readJson(path.join(evidenceDir, "deployment-txs.json"));
  const verification = readJson(path.join(evidenceDir, "verification.json"));
  const walletPreflight = readJson(path.join(evidenceDir, "wallet-preflight.json"));
  const report = readJson(path.join(evidenceDir, "report.json"));

  if (report.status !== "success" || (report.failed || []).length !== 0) {
    fail(
      "CONTRACT-EVIDENCE-STATUS",
      `report.json status must be success with failed.length=0; got ${report.status}.`,
      "fix the failed deployment evidence and rerun npm run deploy:contracts:arbitrum-sepolia.",
    );
  }
  if (manifest.chainId !== CHAIN_ID || walletPreflight.chainId !== CHAIN_ID) {
    fail(
      "CONTRACT-EVIDENCE-CHAIN",
      `chainId must be ${CHAIN_ID} for Arbitrum Sepolia.`,
      "regenerate evidence against ARBITRUM_SEPOLIA_RPC_URL only.",
    );
  }

  const mockUsdc = manifest.contracts?.mockUsdc;
  const synapseCore = manifest.contracts?.synapseCore;
  assertAddress(manifest.deployer, "manifest.deployer");
  assertAddress(manifest.owner, "manifest.owner");
  assertAddress(manifest.withdrawSigner, "manifest.withdrawSigner");
  assertAddress(mockUsdc?.address, "MockUSDC address");
  assertAddress(synapseCore?.address, "SynapseCore address");

  const lowerRoles = [
    manifest.deployer.toLowerCase(),
    manifest.owner.toLowerCase(),
    manifest.withdrawSigner.toLowerCase(),
  ];
  if (new Set(lowerRoles).size !== lowerRoles.length) {
    fail(
      "CONTRACT-EVIDENCE-ROLES",
      "deployer, contract owner, and withdraw signer must be separate addresses.",
      "rotate staging roles and redeploy with three-wallet separation.",
    );
  }

  const mockArtifact = artifactHash("MockUSDC");
  const coreArtifact = artifactHash("SynapseCore");
  if (mockUsdc.abiHash !== mockArtifact.abiHash || mockUsdc.bytecodeHash !== mockArtifact.bytecodeHash) {
    fail(
      "CONTRACT-EVIDENCE-HASH",
      "MockUSDC ABI or bytecode hash does not match local artifact.",
      "rerun npx hardhat compile, redeploy if the contract changed, and regenerate evidence.",
    );
  }
  if (synapseCore.abiHash !== coreArtifact.abiHash || synapseCore.bytecodeHash !== coreArtifact.bytecodeHash) {
    fail(
      "CONTRACT-EVIDENCE-HASH",
      "SynapseCore ABI or bytecode hash does not match local artifact.",
      "rerun npx hardhat compile, redeploy if the contract changed, and regenerate evidence.",
    );
  }

  if (mockUsdc.constructorArgsHash !== sha256(stableStringify(mockUsdc.constructorArgs))) {
    fail(
      "CONTRACT-EVIDENCE-CONSTRUCTOR",
      "MockUSDC constructor args hash cannot be recomputed.",
      "regenerate contract-manifest.json from the deployment script instead of editing it manually.",
    );
  }
  if (synapseCore.constructorArgsHash !== sha256(stableStringify(synapseCore.constructorArgs))) {
    fail(
      "CONTRACT-EVIDENCE-CONSTRUCTOR",
      "SynapseCore constructor args hash cannot be recomputed.",
      "regenerate contract-manifest.json from the deployment script instead of editing it manually.",
    );
  }

  for (const [label, record] of Object.entries({
    mockUsdcDeploy: deploymentTxs.mockUsdcDeploy,
    mockUsdcMintConsumer: deploymentTxs.mockUsdcMintConsumer,
    mockUsdcMintProvider: deploymentTxs.mockUsdcMintProvider,
    mockUsdcTransferOwnership: deploymentTxs.mockUsdcTransferOwnership,
    synapseCoreDeploy: deploymentTxs.synapseCoreDeploy,
  })) {
    assertDeploymentTx(record, label);
  }
  assertVerification(verification);

  for (const role of ["deployer", "consumer", "provider"]) {
    const wallet = (walletPreflight.wallets || []).find((entry) => entry.role === role);
    if (!wallet || wallet.pass !== true || Number(wallet.balanceEth) < Number(wallet.minRequiredEth)) {
      fail(
        "CONTRACT-EVIDENCE-WALLET",
        `${role} wallet gas preflight is missing or below threshold.`,
        "fund the deployer/consumer/provider Arbitrum Sepolia wallets and rerun deployment evidence.",
      );
    }
  }

  const secretFailures = scanEvidenceForSecrets(evidenceDir);
  if (secretFailures.length > 0) {
    fail(
      "CONTRACT-EVIDENCE-SECRET",
      secretFailures.join("; "),
      "remove secrets from evidence artifacts; evidence may include addresses and tx hashes, never private keys, API keys, tokens, or raw signatures.",
    );
  }

  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    fail(
      "CONTRACT-EVIDENCE-RPC",
      "ARBITRUM_SEPOLIA_RPC_URL is required to verify deployed bytecode and on-chain state.",
      "set ARBITRUM_SEPOLIA_RPC_URL and rerun npm run ci:contract-deployment-evidence.",
    );
  }
  const provider = new JsonRpcProvider(rpcUrl, CHAIN_ID);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== CHAIN_ID) {
    fail(
      "CONTRACT-EVIDENCE-RPC",
      `RPC returned chainId ${network.chainId}; expected ${CHAIN_ID}.`,
      "point ARBITRUM_SEPOLIA_RPC_URL at Arbitrum Sepolia and rerun the evidence gate.",
    );
  }

  const mockCode = await provider.getCode(mockUsdc.address);
  const coreCode = await provider.getCode(synapseCore.address);
  if (mockCode === "0x" || coreCode === "0x") {
    fail(
      "CONTRACT-EVIDENCE-CODE",
      "MockUSDC or SynapseCore has no bytecode on Arbitrum Sepolia.",
      "verify the manifest addresses and redeploy if necessary.",
    );
  }
  if (keccak256(mockCode) !== mockUsdc.deployedCodeHash || keccak256(coreCode) !== synapseCore.deployedCodeHash) {
    fail(
      "CONTRACT-EVIDENCE-CODE",
      "On-chain deployed code hash does not match contract-manifest.json.",
      "do not edit evidence by hand; regenerate evidence from the deployed contracts.",
    );
  }

  const mock = new Contract(mockUsdc.address, ERC20_OWNER_ABI, provider);
  const core = new Contract(synapseCore.address, SYNAPSE_CORE_ABI, provider);
  const [mockOwner, decimals, coreOwner, platformSigner, coreUsdc] = await Promise.all([
    mock.owner(),
    mock.decimals(),
    core.owner(),
    core.platformSigner(),
    core.usdc(),
  ]);

  if (getAddress(mockOwner) !== getAddress(manifest.owner) || getAddress(coreOwner) !== getAddress(manifest.owner)) {
    fail(
      "CONTRACT-EVIDENCE-OWNER",
      "On-chain owner does not match staging owner in manifest.",
      "fix role configuration and redeploy staging contracts.",
    );
  }
  if (getAddress(platformSigner) !== getAddress(manifest.withdrawSigner)) {
    fail(
      "CONTRACT-EVIDENCE-SIGNER",
      "On-chain withdraw signer does not match manifest.",
      "fix STAGING_WITHDRAW_SIGNER_ADDRESS and redeploy SynapseCore.",
    );
  }
  if (getAddress(coreUsdc) !== getAddress(mockUsdc.address) || Number(decimals) !== mockUsdc.decimals) {
    fail(
      "CONTRACT-EVIDENCE-USDC",
      "SynapseCore USDC pointer or MockUSDC decimals do not match manifest.",
      "redeploy SynapseCore with the manifest MockUSDC address.",
    );
  }

  const preMintAtomic = BigInt(manifest.preMint?.amountAtomic || "0");
  const recordedPreMintBalances = mockUsdc.preMintBalances || {};
  for (const recipient of manifest.preMint?.recipients || []) {
    const recordedBalance = BigInt(recordedPreMintBalances[recipient.role] || "0");
    if (recordedBalance < preMintAtomic) {
      fail(
        "CONTRACT-EVIDENCE-PREMINT",
        `${recipient.role} wallet recorded pre-mint balance is below pre-mint amount.`,
        "regenerate contract deployment evidence from the deployment script; the manifest must prove the initial staging E2E wallet pre-mint.",
      );
    }
    const balance = await mock.balanceOf(recipient.address);
    if (balance < preMintAtomic) {
      if (process.env.CONTRACT_EVIDENCE_REQUIRE_CURRENT_PREMINT_BALANCE === "1") {
        fail(
          "CONTRACT-EVIDENCE-PREMINT",
          `${recipient.role} wallet MockUSDC balance is below pre-mint amount.`,
          "rerun the deployment script or mint owner-only staging MockUSDC to the dedicated E2E wallet.",
        );
      }
      console.warn(
        `WARN CONTRACT-EVIDENCE-PREMINT-CURRENT: ${recipient.role} wallet current MockUSDC balance is below initial pre-mint amount; ` +
          "deployment pre-mint evidence is still valid because staging E2E wallets are mutable.",
      );
    }
  }

  console.log(`Contract deployment evidence OK: ${evidenceDir}`);
}

main().catch((error) => {
  fail(
    "CONTRACT-EVIDENCE-UNEXPECTED",
    error instanceof Error ? error.message : String(error),
    "inspect the evidence checker failure, fix the manifest/deployment/RPC issue, and rerun npm run ci:contract-deployment-evidence.",
  );
});
