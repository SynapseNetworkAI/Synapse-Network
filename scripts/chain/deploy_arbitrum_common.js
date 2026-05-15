const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const hre = require("hardhat");

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

function requireAnyEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  throw new Error(`Missing required env ${names.join(" or ")}`);
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

async function getWalletPreflight({ deployer, walletRoles, minGasWei }) {
  const wallets = [];

  for (const [role, address] of walletRoles) {
    const balanceWei =
      role === "deployer"
        ? await hre.ethers.provider.getBalance(deployer.address)
        : await hre.ethers.provider.getBalance(address);
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

function isInvalidExplorerApiKey(error) {
  const text = String(error && (error.message || error));
  return /invalid api key|deprecated v1 endpoint|switch to etherscan api v2/i.test(text);
}

async function verifyWithRetry({
  explorerUrl,
  contractName,
  address,
  constructorArguments,
  retries,
  retryDelayMs,
}) {
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
        explorerUrl: `${explorerUrl}/address/${address}#code`,
      };
    } catch (error) {
      if (isAlreadyVerified(error)) {
        attempts.push({ attempt, status: "already_verified" });
        return {
          contractName,
          address,
          status: "already_verified",
          attempts,
          explorerUrl: `${explorerUrl}/address/${address}#code`,
        };
      }

      if (isInvalidExplorerApiKey(error)) {
        attempts.push({
          attempt,
          status: "failed",
          error:
            "Invalid explorer API key. Use an Etherscan API V2 key; old Arbiscan/chain-specific keys are rejected.",
        });
        break;
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
    explorerUrl: `${explorerUrl}/address/${address}#code`,
  };
}

function reportMarkdown(report, config) {
  const deployedContracts = [];
  if (report.contracts?.mockUsdc?.address) {
    deployedContracts.push(`- MockUSDC: ${report.contracts.mockUsdc.address}`);
  }
  if (report.contracts?.synapseCore?.address) {
    deployedContracts.push(`- SynapseCore: ${report.contracts.synapseCore.address}`);
  }

  const lines = [
    `# ${config.reportTitle}`,
    "",
    `- Status: ${report.status}`,
    `- Environment: ${report.environment}`,
    `- Chain: ${report.chainName} (${report.chainId})`,
    `- Generated at: ${report.generatedAt}`,
    `- Deployer: ${report.deployer}`,
    `- Contract owner: ${report.owner}`,
    `- Withdraw signer: ${report.withdrawSigner}`,
    ...deployedContracts,
    `- Failed checks: ${report.failed.length}`,
  ];

  if (report.failed.length > 0) {
    lines.push("", "## Failed", "");
    for (const failure of report.failed) {
      lines.push(`- ${failure}`);
    }
  }

  lines.push("", "## Notes", "");
  for (const note of config.reportNotes) {
    lines.push(`- ${note}`);
  }

  return `${lines.join("\n")}\n`;
}

async function runDeployment(config) {
  const dryRun =
    process.env.SYNAPSE_DEPLOY_DRY_RUN === "1" || process.argv.includes("--dry-run");
  const generatedAt = new Date().toISOString();
  const evidenceDir = path.join(
    config.evidenceRoot,
    `${timestampForPath()}-${dryRun ? "dry-run" : "deploy"}`,
  );
  mkdirp(evidenceDir);

  const failed = [];
  const deploymentTxs = {};
  const verification = { contracts: [] };

  const rpcUrl = requireEnv(config.rpcEnv);
  const deployerPrivateKey = requirePrivateKey(config.deployerPrivateKeyEnv);
  const ownerAddress = requireAddress(config.ownerEnv);
  const withdrawSignerAddress = requireAddress(config.withdrawSignerEnv);
  requireAnyEnv(config.explorerApiKeyEnvNames);

  const deployer = new hre.ethers.Wallet(deployerPrivateKey, hre.ethers.provider);
  const minGasWei = hre.ethers.parseEther(
    process.env[config.minGasEthEnv] || config.defaultMinGasEth,
  );
  const confirmations = Number(
    process.env[config.confirmationsEnv] || config.defaultConfirmations,
  );
  const verifyDelayMs = Number(process.env[config.verifyDelayEnv] || config.defaultVerifyDelayMs);
  const verifyRetries = Number(process.env[config.verifyRetriesEnv] || config.defaultVerifyRetries);
  const verifyRetryDelayMs = Number(
    process.env[config.verifyRetryDelayEnv] || config.defaultVerifyRetryDelayMs,
  );

  let usdcAddress = "";
  let consumerAddress = "";
  let providerAddress = "";
  let preMintUsdc = null;
  let preMintAtomic = null;

  if (config.mockUsdc) {
    consumerAddress = requireAddress(config.mockUsdc.consumerEnv);
    providerAddress = requireAddress(config.mockUsdc.providerEnv);
    preMintUsdc = process.env[config.mockUsdc.preMintEnv] || config.mockUsdc.defaultPreMint;
    preMintAtomic = hre.ethers.parseUnits(preMintUsdc, 18);
  } else {
    usdcAddress = requireAddress(config.usdcTokenEnv);
  }

  if (deployer.address.toLowerCase() === ownerAddress.toLowerCase()) {
    failed.push(`${config.deployerPrivateKeyEnv} and ${config.ownerEnv} must be separate roles`);
  }
  if (deployer.address.toLowerCase() === withdrawSignerAddress.toLowerCase()) {
    failed.push(
      `${config.deployerPrivateKeyEnv} and ${config.withdrawSignerEnv} must be separate roles`,
    );
  }
  if (ownerAddress.toLowerCase() === withdrawSignerAddress.toLowerCase()) {
    failed.push(`${config.ownerEnv} and ${config.withdrawSignerEnv} must be separate roles`);
  }

  await hre.run("compile");

  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== config.chainId) {
    failed.push(`RPC chainId must be ${config.chainId}, got ${network.chainId}`);
  }

  const walletRoles = [["deployer", deployer.address]];
  if (config.mockUsdc) {
    walletRoles.push(["consumer", consumerAddress], ["provider", providerAddress]);
  }
  const wallets = await getWalletPreflight({
    deployer,
    walletRoles,
    minGasWei,
  });

  for (const wallet of wallets) {
    if (!wallet.pass) {
      failed.push(`${wallet.role} wallet ${wallet.address} has insufficient gas`);
    }
  }

  const walletPreflight = {
    generatedAt,
    environment: dryRun ? "dry-run" : config.environmentLabel,
    network: config.networkName,
    chainName: config.chainName,
    chainId: Number(config.chainId),
    rpc: rpcSummary(rpcUrl),
    minGasEth: hre.ethers.formatEther(minGasWei),
    wallets,
  };
  writeJson(path.join(evidenceDir, "wallet-preflight.json"), walletPreflight);

  const manifest = {
    generatedAt,
    environment: dryRun ? "dry-run" : config.environmentLabel,
    network: config.networkName,
    chainName: config.chainName,
    chainId: Number(config.chainId),
    explorer: config.explorerUrl,
    deployer: deployer.address,
    owner: ownerAddress,
    withdrawSigner: withdrawSignerAddress,
    contracts: {},
  };

  if (config.mockUsdc) {
    manifest.preMint = {
      amount: preMintUsdc,
      decimals: 18,
      amountAtomic: preMintAtomic.toString(),
      recipients: [
        { role: "consumer", address: consumerAddress },
        { role: "provider", address: providerAddress },
      ],
    };
  } else {
    manifest.usdcTokenAddress = usdcAddress;
  }

  if (!dryRun && failed.length === 0) {
    if (config.mockUsdc) {
      const MockUSDC = await hre.ethers.getContractFactory("MockUSDC", deployer);
      const mockUsdc = await MockUSDC.deploy(deployer.address);
      await mockUsdc.waitForDeployment();
      usdcAddress = await mockUsdc.getAddress();
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

      const mockArtifact = artifactHash("MockUSDC");
      const mockCode = await hre.ethers.provider.getCode(usdcAddress);
      const consumerMockBalance = await mockUsdc.balanceOf(consumerAddress);
      const providerMockBalance = await mockUsdc.balanceOf(providerAddress);

      manifest.contracts.mockUsdc = {
        address: usdcAddress,
        owner: await mockUsdc.owner(),
        symbol: await mockUsdc.symbol(),
        decimals: Number(await mockUsdc.decimals()),
        constructorArgs: [deployer.address],
        constructorArgsHash: sha256(stableStringify([deployer.address])),
        abiHash: mockArtifact.abiHash,
        bytecodeHash: mockArtifact.bytecodeHash,
        deployedCodeHash: hre.ethers.keccak256(mockCode),
        explorerUrl: `${config.explorerUrl}/address/${usdcAddress}`,
        preMintBalances: {
          consumer: consumerMockBalance.toString(),
          provider: providerMockBalance.toString(),
        },
      };
    }

    const SynapseCore = await hre.ethers.getContractFactory("SynapseCore", deployer);
    const core = await SynapseCore.deploy(usdcAddress, withdrawSignerAddress, ownerAddress);
    await core.waitForDeployment();
    const coreAddress = await core.getAddress();
    deploymentTxs.synapseCoreDeploy = await waitForReceipt(
      core.deploymentTransaction(),
      confirmations,
    );

    const coreArtifact = artifactHash("SynapseCore");
    const coreCode = await hre.ethers.provider.getCode(coreAddress);

    manifest.contracts.synapseCore = {
      address: coreAddress,
      owner: await core.owner(),
      withdrawSigner: await core.platformSigner(),
      usdc: await core.usdc(),
      constructorArgs: [usdcAddress, withdrawSignerAddress, ownerAddress],
      constructorArgsHash: sha256(stableStringify([usdcAddress, withdrawSignerAddress, ownerAddress])),
      abiHash: coreArtifact.abiHash,
      bytecodeHash: coreArtifact.bytecodeHash,
      deployedCodeHash: hre.ethers.keccak256(coreCode),
      explorerUrl: `${config.explorerUrl}/address/${coreAddress}`,
    };

    await delay(verifyDelayMs);
    if (config.mockUsdc) {
      verification.contracts.push(
        await verifyWithRetry({
          explorerUrl: config.explorerUrl,
          contractName: "MockUSDC",
          address: usdcAddress,
          constructorArguments: [deployer.address],
          retries: verifyRetries,
          retryDelayMs: verifyRetryDelayMs,
        }),
      );
    }
    verification.contracts.push(
      await verifyWithRetry({
        explorerUrl: config.explorerUrl,
        contractName: "SynapseCore",
        address: coreAddress,
        constructorArguments: [usdcAddress, withdrawSignerAddress, ownerAddress],
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
    environment: dryRun ? "dry-run" : config.environmentLabel,
    network: config.networkName,
    chainName: config.chainName,
    chainId: Number(config.chainId),
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
  fs.writeFileSync(path.join(evidenceDir, "report.md"), reportMarkdown(report, config));

  console.log(`${config.chainName} deployment evidence: ${evidenceDir}`);
  if (failed.length > 0) {
    for (const failure of failed) {
      console.error(`FATAL CONTRACT-DEPLOY-001: ${failure}`);
    }
    process.exit(1);
  }
}

module.exports = {
  runDeployment,
};
