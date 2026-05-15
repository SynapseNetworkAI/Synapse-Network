const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { verifyWithRetry, writeJson } = require("./contract_script_support");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function resolveEvidenceDir(evidenceRoot) {
  if (process.env.CONTRACT_DEPLOYMENT_EVIDENCE_DIR) {
    return path.resolve(process.env.CONTRACT_DEPLOYMENT_EVIDENCE_DIR);
  }
  if (!fs.existsSync(evidenceRoot)) {
    throw new Error(`Evidence root does not exist: ${evidenceRoot}`);
  }
  const dirs = fs
    .readdirSync(evidenceRoot)
    .map((entry) => path.join(evidenceRoot, entry))
    .filter((entryPath) => fs.statSync(entryPath).isDirectory())
    .filter((entryPath) =>
      fs.existsSync(path.join(entryPath, "contract-manifest.json"))
    )
    .sort()
    .reverse();
  if (dirs.length === 0) {
    throw new Error(`No evidence directories found in ${evidenceRoot}`);
  }
  return dirs[0];
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
    `- Verification updated at: ${report.verificationUpdatedAt || "n/a"}`,
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

function loadEvidenceBundle(evidenceDir) {
  return {
    evidenceDir,
    manifestPath: path.join(evidenceDir, "contract-manifest.json"),
    verificationPath: path.join(evidenceDir, "verification.json"),
    reportPath: path.join(evidenceDir, "report.json"),
    reportMarkdownPath: path.join(evidenceDir, "report.md"),
  };
}

function readEvidence(bundle) {
  const manifest = readJson(bundle.manifestPath);
  const report = readJson(bundle.reportPath);
  return {
    manifest,
    report,
    synapseCore: manifest.contracts?.synapseCore,
  };
}

function validateEvidence(config, manifest, synapseCore) {
  if (manifest.chainId !== Number(config.chainId)) {
    throw new Error(
      `Evidence chainId must be ${config.chainId}, got ${manifest.chainId}`
    );
  }
  if (!synapseCore?.address) {
    throw new Error("Evidence manifest is missing SynapseCore address");
  }
}

async function validateVerificationNetwork(config) {
  await hre.run("compile");
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== config.chainId) {
    throw new Error(
      `RPC chainId must be ${config.chainId}, got ${network.chainId}`
    );
  }
}

function readRetryPolicy(config) {
  return {
    retries: Number(
      process.env[config.verifyRetriesEnv] || config.defaultVerifyRetries
    ),
    retryDelayMs: Number(
      process.env[config.verifyRetryDelayEnv] ||
        config.defaultVerifyRetryDelayMs
    ),
  };
}

async function verifyContract(
  config,
  contractName,
  address,
  constructorArguments,
  retryPolicy
) {
  return verifyWithRetry({
    explorerUrl: config.explorerUrl,
    contractName,
    address,
    constructorArguments,
    retries: retryPolicy.retries,
    retryDelayMs: retryPolicy.retryDelayMs,
  });
}

async function buildVerificationResults(
  config,
  manifest,
  synapseCore,
  retryPolicy
) {
  const verification = { contracts: [] };
  if (config.mockUsdc) {
    const mockUsdc = manifest.contracts?.mockUsdc;
    if (!mockUsdc?.address) {
      throw new Error("Evidence manifest is missing MockUSDC address");
    }
    verification.contracts.push(
      await verifyContract(
        config,
        "MockUSDC",
        mockUsdc.address,
        mockUsdc.constructorArgs || [manifest.deployer],
        retryPolicy
      )
    );
  }

  verification.contracts.push(
    await verifyContract(
      config,
      "SynapseCore",
      synapseCore.address,
      synapseCore.constructorArgs || [
        config.mockUsdc
          ? manifest.contracts.mockUsdc.address
          : manifest.usdcTokenAddress,
        manifest.withdrawSigner,
        manifest.owner,
      ],
      retryPolicy
    )
  );
  return verification;
}

function collectFailures(existingFailures, verificationContracts) {
  const failed = existingFailures.filter(
    (entry) => !/Arbiscan verification failed/i.test(entry)
  );
  for (const result of verificationContracts) {
    if (!["success", "already_verified"].includes(result.status)) {
      failed.push(`${result.contractName} Arbiscan verification failed`);
    }
  }
  return failed;
}

function writeVerificationOutputs(bundle, updatedReport, verification, config) {
  writeJson(bundle.verificationPath, verification);
  writeJson(bundle.reportPath, updatedReport);
  fs.writeFileSync(
    bundle.reportMarkdownPath,
    reportMarkdown(updatedReport, config)
  );
}

async function runVerification(config) {
  requireEnv(config.rpcEnv);
  requireAnyEnv(config.explorerApiKeyEnvNames);
  const evidenceDir = resolveEvidenceDir(config.evidenceRoot);
  const bundle = loadEvidenceBundle(evidenceDir);
  const { manifest, report, synapseCore } = readEvidence(bundle);
  validateEvidence(config, manifest, synapseCore);
  await validateVerificationNetwork(config);
  const retryPolicy = readRetryPolicy(config);
  const verification = await buildVerificationResults(
    config,
    manifest,
    synapseCore,
    retryPolicy
  );
  const failed = collectFailures(report.failed || [], verification.contracts);

  const updatedReport = {
    ...report,
    verificationUpdatedAt: new Date().toISOString(),
    failed,
    status: failed.length === 0 ? "success" : "failed",
    chainName: config.chainName,
    chainId: Number(config.chainId),
    contracts: manifest.contracts,
  };

  writeVerificationOutputs(bundle, updatedReport, verification, config);

  console.log(
    `${config.chainName} verification evidence updated: ${evidenceDir}`
  );
  if (failed.length > 0) {
    for (const failure of failed) {
      console.error(`FATAL CONTRACT-VERIFY-001: ${failure}`);
    }
    process.exit(1);
  }
}

module.exports = {
  runVerification,
};
