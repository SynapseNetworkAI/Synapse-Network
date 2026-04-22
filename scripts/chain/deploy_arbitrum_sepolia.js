const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const hre = require("hardhat");

const CHAIN_ID = 421614n;
const CHAIN_NAME = "Arbitrum Sepolia";
const NETWORK_NAME = "arbitrumSepolia";
const EXPLORER_URL = "https://sepolia.arbiscan.io";
const EVIDENCE_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  "docs",
  "evidence",
  "release",
  "contracts",
  "arbitrum-sepolia",
);
const DEFAULT_MIN_GAS_ETH = "0.01";
const DEFAULT_PREMINT_USDC = "100000";
const DEFAULT_CONFIRMATIONS = 5;
const DEFAULT_VERIFY_DELAY_MS = 15000;
const DEFAULT_VERIFY_RETRIES = 5;
const DEFAULT_VERIFY_RETRY_DELAY_MS = 15000;

function timestampForPath() {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z");
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function isZeroAddress(address) {
  return address.toLowerCase() === hre.ethers.ZeroAddress.toLowerCase();
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env ${name}`);
  }
  return value.trim();
}

function requireAddress(name) {
  const value = requireEnv(name);
  if (!hre.ethers.isAddress(value) || isZeroAddress(value)) {
    throw new Error(`${name} must be a non-zero Ethereum address`);
  }
  return hre.ethers.getAddress(value);
}

function requirePrivateKey(name) {
  const value = requireEnv(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 0x-prefixed 32-byte private key`);
  }
  return value;
}

function rpcSummary(rawUrl) {
  const url = new URL(rawUrl);
  const redactedPath = url.pathname.replace(/\/v2\/[^/]+/i, "/v2/[REDACTED]");
  return {
    protocol: url.protocol,
    host: url.host,
    path: redactedPath || "/",
  };
}

function artifactHash(contractName) {
  const artifactPath = path.resolve(
    __dirname,
    "..",
    "..",
    "artifacts",
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`,
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return {
    abiHash: sha256(stableStringify(artifact.abi)),
    bytecodeHash: sha256(artifact.bytecode),
  };
}

async function getWalletPreflight({ deployer, consumerAddress, providerAddress, minGasWei }) {
  const roles = [
    ["deployer", deployer.address],
    ["consumer", consumerAddress],
    ["provider", providerAddress],
  ];
  const wallets = [];

  for (const [role, address] of roles) {
    const balanceWei = await hre.ethers.provider.getBalance(address);
    wallets.push({
      role,
      address,
      balanceEth: hre.ethers.formatEther(balanceWei),
      minRequiredEth: hre.ethers.formatEther(minGasWei),
      pass: balanceWei >= minGasWei,
    });
  }

  return wallets;
}

async function waitForReceipt(tx, confirmations) {
  const receipt = await tx.wait(confirmations);
  return {
    hash: tx.hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  };
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlreadyVerified(error) {
  const text = String(error && (error.message || error));
  return /already verified|already been verified|contract source code already verified/i.test(text);
}

async function verifyWithRetry({ contractName, address, constructorArguments, retries, retryDelayMs }) {
  const attempts = [];

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments,
      });
      attempts.push({ attempt, status: "success" });
      return {
        contractName,
        address,
        status: "success",
        attempts,
        explorerUrl: `${EXPLORER_URL}/address/${address}#code`,
      };
    } catch (error) {
      if (isAlreadyVerified(error)) {
        attempts.push({ attempt, status: "already_verified" });
        return {
          contractName,
          address,
          status: "already_verified",
          attempts,
          explorerUrl: `${EXPLORER_URL}/address/${address}#code`,
        };
      }

      attempts.push({
        attempt,
        status: "failed",
        error: String(error && (error.message || error)).slice(0, 600),
      });

      if (attempt < retries) {
        await delay(retryDelayMs);
      }
    }
  }

  return {
    contractName,
    address,
    status: "failed",
    attempts,
    explorerUrl: `${EXPLORER_URL}/address/${address}#code`,
  };
}

function reportMarkdown(report) {
  const lines = [
    "# Arbitrum Sepolia Contract Deployment Evidence",
    "",
    `- Status: ${report.status}`,
    `- Environment: ${report.environment}`,
    `- Chain: ${report.chainName} (${report.chainId})`,
    `- Generated at: ${report.generatedAt}`,
    `- Deployer: ${report.deployer}`,
    `- Contract owner: ${report.owner}`,
    `- Withdraw signer: ${report.withdrawSigner}`,
    `- MockUSDC: ${report.contracts?.mockUsdc?.address || "not deployed"}`,
    `- SynapseCore: ${report.contracts?.synapseCore?.address || "not deployed"}`,
    `- Failed checks: ${report.failed.length}`,
  ];

  if (report.failed.length > 0) {
    lines.push("", "## Failed", "");
    for (const failure of report.failed) {
      lines.push(`- ${failure}`);
    }
  }

  lines.push(
    "",
    "## Notes",
    "",
    "- Staging uses owner-only MockUSDC, not real USDC.",
    "- Evidence intentionally excludes private keys, RPC API keys, raw signatures, JWTs, and admin tokens.",
    "- Arbiscan verification waits after deployment and retries bounded attempts to avoid explorer indexing races.",
  );

  return `${lines.join("\n")}\n`;
}

async function main() {
  const dryRun = process.env.SYNAPSE_DEPLOY_DRY_RUN === "1" || process.argv.includes("--dry-run");
  const generatedAt = new Date().toISOString();
  const evidenceDir = path.join(EVIDENCE_ROOT, `${timestampForPath()}-${dryRun ? "dry-run" : "deploy"}`);
  mkdirp(evidenceDir);

  const failed = [];
  const deploymentTxs = {};
  const verification = { contracts: [] };

  const rpcUrl = requireEnv("ARBITRUM_SEPOLIA_RPC_URL");
  const deployerPrivateKey = requirePrivateKey("STAGING_DEPLOYER_PRIVATE_KEY");
  const ownerAddress = requireAddress("STAGING_CONTRACT_OWNER_ADDRESS");
  const withdrawSignerAddress = requireAddress("STAGING_WITHDRAW_SIGNER_ADDRESS");
  const consumerAddress = requireAddress("STAGING_TEST_CONSUMER_ADDRESS");
  const providerAddress = requireAddress("STAGING_TEST_PROVIDER_ADDRESS");
  requireEnv("ARBISCAN_API_KEY");

  const deployer = new hre.ethers.Wallet(deployerPrivateKey, hre.ethers.provider);
  const minGasWei = hre.ethers.parseEther(process.env.STAGING_MIN_GAS_ETH || DEFAULT_MIN_GAS_ETH);
  const preMintUsdc = process.env.STAGING_TEST_MOCK_USDC_PREMINT || DEFAULT_PREMINT_USDC;
  const preMintAtomic = hre.ethers.parseUnits(preMintUsdc, 18);
  const confirmations = Number(process.env.STAGING_DEPLOY_CONFIRMATIONS || DEFAULT_CONFIRMATIONS);
  const verifyDelayMs = Number(process.env.STAGING_VERIFY_DELAY_MS || DEFAULT_VERIFY_DELAY_MS);
  const verifyRetries = Number(process.env.STAGING_VERIFY_RETRIES || DEFAULT_VERIFY_RETRIES);
  const verifyRetryDelayMs = Number(
    process.env.STAGING_VERIFY_RETRY_DELAY_MS || DEFAULT_VERIFY_RETRY_DELAY_MS,
  );

  if (deployer.address.toLowerCase() === ownerAddress.toLowerCase()) {
    failed.push("STAGING_DEPLOYER_PRIVATE_KEY and STAGING_CONTRACT_OWNER_ADDRESS must be separate roles");
  }
  if (deployer.address.toLowerCase() === withdrawSignerAddress.toLowerCase()) {
    failed.push("STAGING_DEPLOYER_PRIVATE_KEY and STAGING_WITHDRAW_SIGNER_ADDRESS must be separate roles");
  }
  if (ownerAddress.toLowerCase() === withdrawSignerAddress.toLowerCase()) {
    failed.push("STAGING_CONTRACT_OWNER_ADDRESS and STAGING_WITHDRAW_SIGNER_ADDRESS must be separate roles");
  }

  await hre.run("compile");

  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    failed.push(`RPC chainId must be ${CHAIN_ID}, got ${network.chainId}`);
  }

  const wallets = await getWalletPreflight({
    deployer,
    consumerAddress,
    providerAddress,
    minGasWei,
  });

  for (const wallet of wallets) {
    if (!wallet.pass) {
      failed.push(`${wallet.role} wallet ${wallet.address} has insufficient gas`);
    }
  }

  const walletPreflight = {
    generatedAt,
    environment: dryRun ? "dry-run" : "staging",
    network: NETWORK_NAME,
    chainName: CHAIN_NAME,
    chainId: Number(CHAIN_ID),
    rpc: rpcSummary(rpcUrl),
    minGasEth: hre.ethers.formatEther(minGasWei),
    wallets,
  };
  writeJson(path.join(evidenceDir, "wallet-preflight.json"), walletPreflight);

  let manifest = {
    generatedAt,
    environment: dryRun ? "dry-run" : "staging",
    network: NETWORK_NAME,
    chainName: CHAIN_NAME,
    chainId: Number(CHAIN_ID),
    explorer: EXPLORER_URL,
    deployer: deployer.address,
    owner: ownerAddress,
    withdrawSigner: withdrawSignerAddress,
    contracts: {},
    preMint: {
      amount: preMintUsdc,
      decimals: 18,
      amountAtomic: preMintAtomic.toString(),
      recipients: [
        { role: "consumer", address: consumerAddress },
        { role: "provider", address: providerAddress },
      ],
    },
  };

  if (!dryRun && failed.length === 0) {
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC", deployer);
    const mockUsdc = await MockUSDC.deploy(deployer.address);
    await mockUsdc.waitForDeployment();
    const mockUsdcAddress = await mockUsdc.getAddress();
    deploymentTxs.mockUsdcDeploy = await waitForReceipt(
      mockUsdc.deploymentTransaction(),
      confirmations,
    );

    const consumerMintTx = await mockUsdc.mint(consumerAddress, preMintAtomic);
    deploymentTxs.mockUsdcMintConsumer = await waitForReceipt(consumerMintTx, confirmations);

    const providerMintTx = await mockUsdc.mint(providerAddress, preMintAtomic);
    deploymentTxs.mockUsdcMintProvider = await waitForReceipt(providerMintTx, confirmations);

    const transferOwnershipTx = await mockUsdc.transferOwnership(ownerAddress);
    deploymentTxs.mockUsdcTransferOwnership = await waitForReceipt(
      transferOwnershipTx,
      confirmations,
    );

    const SynapseCore = await hre.ethers.getContractFactory("SynapseCore", deployer);
    const core = await SynapseCore.deploy(mockUsdcAddress, withdrawSignerAddress, ownerAddress);
    await core.waitForDeployment();
    const coreAddress = await core.getAddress();
    deploymentTxs.synapseCoreDeploy = await waitForReceipt(
      core.deploymentTransaction(),
      confirmations,
    );

    const mockArtifact = artifactHash("MockUSDC");
    const coreArtifact = artifactHash("SynapseCore");
    const mockCode = await hre.ethers.provider.getCode(mockUsdcAddress);
    const coreCode = await hre.ethers.provider.getCode(coreAddress);
    const consumerMockBalance = await mockUsdc.balanceOf(consumerAddress);
    const providerMockBalance = await mockUsdc.balanceOf(providerAddress);

    manifest.contracts.mockUsdc = {
      address: mockUsdcAddress,
      owner: await mockUsdc.owner(),
      symbol: await mockUsdc.symbol(),
      decimals: Number(await mockUsdc.decimals()),
      constructorArgs: [deployer.address],
      constructorArgsHash: sha256(stableStringify([deployer.address])),
      abiHash: mockArtifact.abiHash,
      bytecodeHash: mockArtifact.bytecodeHash,
      deployedCodeHash: hre.ethers.keccak256(mockCode),
      explorerUrl: `${EXPLORER_URL}/address/${mockUsdcAddress}`,
      preMintBalances: {
        consumer: consumerMockBalance.toString(),
        provider: providerMockBalance.toString(),
      },
    };

    manifest.contracts.synapseCore = {
      address: coreAddress,
      owner: await core.owner(),
      withdrawSigner: await core.platformSigner(),
      usdc: await core.usdc(),
      constructorArgs: [mockUsdcAddress, withdrawSignerAddress, ownerAddress],
      constructorArgsHash: sha256(
        stableStringify([mockUsdcAddress, withdrawSignerAddress, ownerAddress]),
      ),
      abiHash: coreArtifact.abiHash,
      bytecodeHash: coreArtifact.bytecodeHash,
      deployedCodeHash: hre.ethers.keccak256(coreCode),
      explorerUrl: `${EXPLORER_URL}/address/${coreAddress}`,
    };

    await delay(verifyDelayMs);
    verification.contracts.push(
      await verifyWithRetry({
        contractName: "MockUSDC",
        address: mockUsdcAddress,
        constructorArguments: [deployer.address],
        retries: verifyRetries,
        retryDelayMs: verifyRetryDelayMs,
      }),
    );
    verification.contracts.push(
      await verifyWithRetry({
        contractName: "SynapseCore",
        address: coreAddress,
        constructorArguments: [mockUsdcAddress, withdrawSignerAddress, ownerAddress],
        retries: verifyRetries,
        retryDelayMs: verifyRetryDelayMs,
      }),
    );

    for (const result of verification.contracts) {
      if (!["success", "already_verified"].includes(result.status)) {
        failed.push(`${result.contractName} Arbiscan verification failed`);
      }
    }
  }

  const status = failed.length === 0 ? (dryRun ? "dry_run_success" : "success") : "failed";
  const report = {
    generatedAt,
    status,
    failed,
    environment: dryRun ? "dry-run" : "staging",
    network: NETWORK_NAME,
    chainName: CHAIN_NAME,
    chainId: Number(CHAIN_ID),
    deployer: deployer.address,
    owner: ownerAddress,
    withdrawSigner: withdrawSignerAddress,
    contracts: manifest.contracts,
    evidenceDir,
  };

  writeJson(path.join(evidenceDir, "contract-manifest.json"), manifest);
  writeJson(path.join(evidenceDir, "deployment-txs.json"), deploymentTxs);
  writeJson(path.join(evidenceDir, "verification.json"), verification);
  writeJson(path.join(evidenceDir, "report.json"), report);
  fs.writeFileSync(path.join(evidenceDir, "report.md"), reportMarkdown(report));

  console.log(`Arbitrum Sepolia deployment evidence: ${evidenceDir}`);
  if (failed.length > 0) {
    for (const failure of failed) {
      console.error(`FATAL CONTRACT-DEPLOY-001: ${failure}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
