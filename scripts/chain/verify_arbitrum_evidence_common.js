const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  return require("crypto").createHash("sha256").update(value).digest("hex");
}

function isAlreadyVerified(error) {
  const text = String(error && (error.message || error));
  return /already verified|already been verified|contract source code already verified/i.test(text);
}

function isInvalidExplorerApiKey(error) {
  const text = String(error && (error.message || error));
  return /invalid api key|deprecated v1 endpoint|switch to etherscan api v2/i.test(text);
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
    .filter((entryPath) => fs.existsSync(path.join(entryPath, "contract-manifest.json")))
    .sort()
    .reverse();
  if (dirs.length === 0) {
    throw new Error(`No evidence directories found in ${evidenceRoot}`);
  }
  return dirs[0];
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

async function runVerification(config) {
  requireEnv(config.rpcEnv);
  requireAnyEnv(config.explorerApiKeyEnvNames);

  const evidenceDir = resolveEvidenceDir(config.evidenceRoot);
  const manifestPath = path.join(evidenceDir, "contract-manifest.json");
  const verificationPath = path.join(evidenceDir, "verification.json");
  const reportPath = path.join(evidenceDir, "report.json");
  const reportMarkdownPath = path.join(evidenceDir, "report.md");

  const manifest = readJson(manifestPath);
  const report = readJson(reportPath);
  const synapseCore = manifest.contracts?.synapseCore;

  if (manifest.chainId !== Number(config.chainId)) {
    throw new Error(`Evidence chainId must be ${config.chainId}, got ${manifest.chainId}`);
  }
  if (!synapseCore?.address) {
    throw new Error("Evidence manifest is missing SynapseCore address");
  }

  await hre.run("compile");
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== config.chainId) {
    throw new Error(`RPC chainId must be ${config.chainId}, got ${network.chainId}`);
  }

  const retries = Number(process.env[config.verifyRetriesEnv] || config.defaultVerifyRetries);
  const retryDelayMs = Number(
    process.env[config.verifyRetryDelayEnv] || config.defaultVerifyRetryDelayMs,
  );
  const verification = { contracts: [] };

  if (config.mockUsdc) {
    const mockUsdc = manifest.contracts?.mockUsdc;
    if (!mockUsdc?.address) {
      throw new Error("Evidence manifest is missing MockUSDC address");
    }
    verification.contracts.push(
      await verifyWithRetry({
        explorerUrl: config.explorerUrl,
        contractName: "MockUSDC",
        address: mockUsdc.address,
        constructorArguments: mockUsdc.constructorArgs || [manifest.deployer],
        retries,
        retryDelayMs,
      }),
    );
  }

  verification.contracts.push(
    await verifyWithRetry({
      explorerUrl: config.explorerUrl,
      contractName: "SynapseCore",
      address: synapseCore.address,
      constructorArguments:
        synapseCore.constructorArgs || [
          config.mockUsdc ? manifest.contracts.mockUsdc.address : manifest.usdcTokenAddress,
          manifest.withdrawSigner,
          manifest.owner,
        ],
      retries,
      retryDelayMs,
    }),
  );

  const failed = (report.failed || []).filter(
    (entry) => !/Arbiscan verification failed/i.test(entry),
  );
  for (const result of verification.contracts) {
    if (!["success", "already_verified"].includes(result.status)) {
      failed.push(`${result.contractName} Arbiscan verification failed`);
    }
  }

  const updatedReport = {
    ...report,
    verificationUpdatedAt: new Date().toISOString(),
    failed,
    status: failed.length === 0 ? "success" : "failed",
    chainName: config.chainName,
    chainId: Number(config.chainId),
    contracts: manifest.contracts,
  };

  writeJson(verificationPath, verification);
  writeJson(reportPath, updatedReport);
  fs.writeFileSync(reportMarkdownPath, reportMarkdown(updatedReport, config));

  console.log(`${config.chainName} verification evidence updated: ${evidenceDir}`);
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
