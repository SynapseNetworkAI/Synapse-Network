const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const {
  artifactHash,
  delay,
  mkdirp,
  rpcSummary,
  sha256,
  stableStringify,
  timestampForPath,
  verifyWithRetry,
  writeJson,
} = require("./contract_script_support");

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

function readDeploymentInputs(config) {
  const rpcUrl = requireEnv(config.rpcEnv);
  const deployerPrivateKey = requirePrivateKey(config.deployerPrivateKeyEnv);
  const ownerAddress = requireAddress(config.ownerEnv);
  const withdrawSignerAddress = requireAddress(config.withdrawSignerEnv);
  requireAnyEnv(config.explorerApiKeyEnvNames);

  const minGasWei = hre.ethers.parseEther(
    process.env[config.minGasEthEnv] || config.defaultMinGasEth
  );
  const confirmations = Number(
    process.env[config.confirmationsEnv] || config.defaultConfirmations
  );
  const verifyDelayMs = Number(
    process.env[config.verifyDelayEnv] || config.defaultVerifyDelayMs
  );
  const verifyRetries = Number(
    process.env[config.verifyRetriesEnv] || config.defaultVerifyRetries
  );
  const verifyRetryDelayMs = Number(
    process.env[config.verifyRetryDelayEnv] || config.defaultVerifyRetryDelayMs
  );

  const inputs = {
    rpcUrl,
    deployerPrivateKey,
    ownerAddress,
    withdrawSignerAddress,
    minGasWei,
    confirmations,
    verifyDelayMs,
    verifyRetries,
    verifyRetryDelayMs,
    usdcAddress: "",
    consumerAddress: "",
    providerAddress: "",
    preMintUsdc: null,
    preMintAtomic: null,
  };

  if (config.mockUsdc) {
    inputs.consumerAddress = requireAddress(config.mockUsdc.consumerEnv);
    inputs.providerAddress = requireAddress(config.mockUsdc.providerEnv);
    inputs.preMintUsdc =
      process.env[config.mockUsdc.preMintEnv] || config.mockUsdc.defaultPreMint;
    inputs.preMintAtomic = hre.ethers.parseUnits(inputs.preMintUsdc, 18);
  } else {
    inputs.usdcAddress = requireAddress(config.usdcTokenEnv);
  }

  return inputs;
}

function appendRoleFailures(
  failed,
  deployerAddress,
  ownerAddress,
  withdrawSignerAddress
) {
  if (deployerAddress.toLowerCase() === ownerAddress.toLowerCase()) {
    failed.push(
      "deployer private key and contract owner must be separate roles"
    );
  }
  if (deployerAddress.toLowerCase() === withdrawSignerAddress.toLowerCase()) {
    failed.push(
      "deployer private key and withdraw signer must be separate roles"
    );
  }
  if (ownerAddress.toLowerCase() === withdrawSignerAddress.toLowerCase()) {
    failed.push("contract owner and withdraw signer must be separate roles");
  }
}

function buildWalletRoles(config, deployerAddress, inputs) {
  const walletRoles = [["deployer", deployerAddress]];
  if (config.mockUsdc) {
    walletRoles.push(
      ["consumer", inputs.consumerAddress],
      ["provider", inputs.providerAddress]
    );
  }
  return walletRoles;
}

function appendGasFailures(failed, wallets) {
  for (const wallet of wallets) {
    if (!wallet.pass) {
      failed.push(
        `${wallet.role} wallet ${wallet.address} has insufficient gas`
      );
    }
  }
}

function buildManifest(config, generatedAt, dryRun, deployerAddress, inputs) {
  const manifest = {
    generatedAt,
    environment: dryRun ? "dry-run" : config.environmentLabel,
    network: config.networkName,
    chainName: config.chainName,
    chainId: Number(config.chainId),
    explorer: config.explorerUrl,
    deployer: deployerAddress,
    owner: inputs.ownerAddress,
    withdrawSigner: inputs.withdrawSignerAddress,
    contracts: {},
  };

  if (config.mockUsdc) {
    manifest.preMint = {
      amount: inputs.preMintUsdc,
      decimals: 18,
      amountAtomic: inputs.preMintAtomic.toString(),
      recipients: [
        { role: "consumer", address: inputs.consumerAddress },
        { role: "provider", address: inputs.providerAddress },
      ],
    };
  } else {
    manifest.usdcTokenAddress = inputs.usdcAddress;
  }

  return manifest;
}

async function deployMockUsdc(
  config,
  deployer,
  inputs,
  deploymentTxs,
  manifest,
  confirmations
) {
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC", deployer);
  const mockUsdc = await MockUSDC.deploy(deployer.address);
  await mockUsdc.waitForDeployment();
  const usdcAddress = await mockUsdc.getAddress();
  deploymentTxs.mockUsdcDeploy = await waitForReceipt(
    mockUsdc.deploymentTransaction(),
    confirmations
  );

  const consumerMintTx = await mockUsdc.mint(
    inputs.consumerAddress,
    inputs.preMintAtomic
  );
  deploymentTxs.mockUsdcMintConsumer = await waitForReceipt(
    consumerMintTx,
    confirmations
  );

  const providerMintTx = await mockUsdc.mint(
    inputs.providerAddress,
    inputs.preMintAtomic
  );
  deploymentTxs.mockUsdcMintProvider = await waitForReceipt(
    providerMintTx,
    confirmations
  );

  const transferOwnershipTx = await mockUsdc.transferOwnership(
    inputs.ownerAddress
  );
  deploymentTxs.mockUsdcTransferOwnership = await waitForReceipt(
    transferOwnershipTx,
    confirmations
  );

  const mockArtifact = artifactHash("MockUSDC");
  const mockCode = await hre.ethers.provider.getCode(usdcAddress);
  const consumerMockBalance = await mockUsdc.balanceOf(inputs.consumerAddress);
  const providerMockBalance = await mockUsdc.balanceOf(inputs.providerAddress);

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

  return usdcAddress;
}

async function deploySynapseCore(
  config,
  deployer,
  usdcAddress,
  inputs,
  deploymentTxs,
  manifest,
  confirmations
) {
  const SynapseCore = await hre.ethers.getContractFactory(
    "SynapseCore",
    deployer
  );
  const core = await SynapseCore.deploy(
    usdcAddress,
    inputs.withdrawSignerAddress,
    inputs.ownerAddress
  );
  await core.waitForDeployment();
  const coreAddress = await core.getAddress();
  deploymentTxs.synapseCoreDeploy = await waitForReceipt(
    core.deploymentTransaction(),
    confirmations
  );

  const coreArtifact = artifactHash("SynapseCore");
  const coreCode = await hre.ethers.provider.getCode(coreAddress);
  manifest.contracts.synapseCore = {
    address: coreAddress,
    owner: await core.owner(),
    withdrawSigner: await core.platformSigner(),
    usdc: await core.usdc(),
    constructorArgs: [
      usdcAddress,
      inputs.withdrawSignerAddress,
      inputs.ownerAddress,
    ],
    constructorArgsHash: sha256(
      stableStringify([
        usdcAddress,
        inputs.withdrawSignerAddress,
        inputs.ownerAddress,
      ])
    ),
    abiHash: coreArtifact.abiHash,
    bytecodeHash: coreArtifact.bytecodeHash,
    deployedCodeHash: hre.ethers.keccak256(coreCode),
    explorerUrl: `${config.explorerUrl}/address/${coreAddress}`,
  };

  return coreAddress;
}

async function runVerificationPass(
  config,
  deployer,
  inputs,
  usdcAddress,
  coreAddress,
  verification
) {
  await delay(inputs.verifyDelayMs);
  if (config.mockUsdc) {
    verification.contracts.push(
      await verifyWithRetry({
        explorerUrl: config.explorerUrl,
        contractName: "MockUSDC",
        address: usdcAddress,
        constructorArguments: [deployer.address],
        retries: inputs.verifyRetries,
        retryDelayMs: inputs.verifyRetryDelayMs,
      })
    );
  }
  verification.contracts.push(
    await verifyWithRetry({
      explorerUrl: config.explorerUrl,
      contractName: "SynapseCore",
      address: coreAddress,
      constructorArguments: [
        usdcAddress,
        inputs.withdrawSignerAddress,
        inputs.ownerAddress,
      ],
      retries: inputs.verifyRetries,
      retryDelayMs: inputs.verifyRetryDelayMs,
    })
  );
}

function appendVerificationFailures(failed, verificationResults) {
  for (const result of verificationResults) {
    if (!["success", "already_verified"].includes(result.status)) {
      failed.push(`${result.contractName} Arbiscan verification failed`);
    }
  }
}

function writeDeploymentEvidence(
  evidenceDir,
  walletPreflight,
  manifest,
  deploymentTxs,
  verification,
  report,
  config
) {
  writeJson(path.join(evidenceDir, "wallet-preflight.json"), walletPreflight);
  writeJson(path.join(evidenceDir, "contract-manifest.json"), manifest);
  writeJson(path.join(evidenceDir, "deployment-txs.json"), deploymentTxs);
  writeJson(path.join(evidenceDir, "verification.json"), verification);
  writeJson(path.join(evidenceDir, "report.json"), report);
  fs.writeFileSync(
    path.join(evidenceDir, "report.md"),
    reportMarkdown(report, config)
  );
}

function reportMarkdown(report, config) {
  const deployedContracts = [];
  if (report.contracts?.mockUsdc?.address) {
    deployedContracts.push(`- MockUSDC: ${report.contracts.mockUsdc.address}`);
  }
  if (report.contracts?.synapseCore?.address) {
    deployedContracts.push(
      `- SynapseCore: ${report.contracts.synapseCore.address}`
    );
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
    process.env.SYNAPSE_DEPLOY_DRY_RUN === "1" ||
    process.argv.includes("--dry-run");
  const generatedAt = new Date().toISOString();
  const evidenceDir = path.join(
    config.evidenceRoot,
    `${timestampForPath()}-${dryRun ? "dry-run" : "deploy"}`
  );
  mkdirp(evidenceDir);

  const failed = [];
  const deploymentTxs = {};
  const verification = { contracts: [] };
  const inputs = readDeploymentInputs(config);
  const deployer = new hre.ethers.Wallet(
    inputs.deployerPrivateKey,
    hre.ethers.provider
  );

  appendRoleFailures(
    failed,
    deployer.address,
    inputs.ownerAddress,
    inputs.withdrawSignerAddress
  );

  await hre.run("compile");

  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== config.chainId) {
    failed.push(
      `RPC chainId must be ${config.chainId}, got ${network.chainId}`
    );
  }

  const walletRoles = buildWalletRoles(config, deployer.address, inputs);
  const wallets = await getWalletPreflight({
    deployer,
    walletRoles,
    minGasWei: inputs.minGasWei,
  });
  appendGasFailures(failed, wallets);

  const walletPreflight = {
    generatedAt,
    environment: dryRun ? "dry-run" : config.environmentLabel,
    network: config.networkName,
    chainName: config.chainName,
    chainId: Number(config.chainId),
    rpc: rpcSummary(inputs.rpcUrl),
    minGasEth: hre.ethers.formatEther(inputs.minGasWei),
    wallets,
  };
  const manifest = buildManifest(
    config,
    generatedAt,
    dryRun,
    deployer.address,
    inputs
  );

  if (!dryRun && failed.length === 0) {
    let usdcAddress = inputs.usdcAddress;
    if (config.mockUsdc) {
      usdcAddress = await deployMockUsdc(
        config,
        deployer,
        inputs,
        deploymentTxs,
        manifest,
        inputs.confirmations
      );
    }
    const coreAddress = await deploySynapseCore(
      config,
      deployer,
      usdcAddress,
      inputs,
      deploymentTxs,
      manifest,
      inputs.confirmations
    );
    await runVerificationPass(
      config,
      deployer,
      inputs,
      usdcAddress,
      coreAddress,
      verification
    );
    appendVerificationFailures(failed, verification.contracts);
  }

  const status =
    failed.length === 0 ? (dryRun ? "dry_run_success" : "success") : "failed";
  const report = {
    generatedAt,
    status,
    failed,
    environment: dryRun ? "dry-run" : config.environmentLabel,
    network: config.networkName,
    chainName: config.chainName,
    chainId: Number(config.chainId),
    deployer: deployer.address,
    owner: inputs.ownerAddress,
    withdrawSigner: inputs.withdrawSignerAddress,
    contracts: manifest.contracts,
    evidenceDir,
  };

  writeDeploymentEvidence(
    evidenceDir,
    walletPreflight,
    manifest,
    deploymentTxs,
    verification,
    report,
    config
  );

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
