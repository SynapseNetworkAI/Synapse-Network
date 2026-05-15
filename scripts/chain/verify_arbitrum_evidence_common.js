const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const {
  renderReportMarkdown,
  writeEvidenceBundle,
} = require("./contract_report_support");
const { requireEnv, verifyWithRetry } = require("./contract_script_support");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function requireExplorerKey(envNames) {
  if (envNames.some((name) => process.env[name]?.trim())) {
    return;
  }
  throw new Error(
    `Missing ${envNames.join(" or ")} for Etherscan API V2 verification`
  );
}

function buildVerificationContract(
  contractName,
  address,
  constructorArguments,
  explorerUrl
) {
  return { contractName, address, constructorArguments, explorerUrl };
}

function buildSummaryLines(report, config) {
  const contracts = config.contractSummary(report.contracts);
  return [
    `- Status: ${report.status}`,
    `- Environment: ${report.environment}`,
    `- Chain: ${report.chainName} (${report.chainId})`,
    `- Generated at: ${report.generatedAt}`,
    `- Verification updated at: ${report.verificationUpdatedAt || "n/a"}`,
    `- Deployer: ${report.deployer}`,
    `- Contract owner: ${report.owner}`,
    `- Withdraw signer: ${report.withdrawSigner}`,
    ...contracts,
    `- Failed checks: ${report.failed.length}`,
  ];
}

function renderUpdatedMarkdown(report, config) {
  return renderReportMarkdown({
    title: config.reportTitle,
    report,
    notes: config.reportNotes,
    summaryLines: buildSummaryLines(report, config),
  });
}

async function verifyContracts(contracts, retries, retryDelayMs) {
  const results = [];
  for (const contract of contracts) {
    results.push(
      await verifyWithRetry({
        explorerUrl: contract.explorerUrl,
        contractName: contract.contractName,
        address: contract.address,
        constructorArguments: contract.constructorArguments,
        retries,
        retryDelayMs,
      })
    );
  }
  return results;
}

function appendVerificationFailures(existingFailed, verificationContracts) {
  const failed = existingFailed.filter(
    (entry) => !/Arbiscan verification failed/i.test(entry)
  );
  for (const result of verificationContracts) {
    if (!["success", "already_verified"].includes(result.status)) {
      failed.push(`${result.contractName} Arbiscan verification failed`);
    }
  }
  return failed;
}

async function runVerification(config) {
  requireEnv(config.rpcEnv);
  requireExplorerKey(config.explorerApiKeyEnvNames);

  const evidenceDir = resolveEvidenceDir(config.evidenceRoot);
  const manifestPath = path.join(evidenceDir, "contract-manifest.json");
  const verificationPath = path.join(evidenceDir, "verification.json");
  const reportPath = path.join(evidenceDir, "report.json");

  const manifest = readJson(manifestPath);
  const report = readJson(reportPath);

  if (manifest.chainId !== Number(config.chainId)) {
    throw new Error(
      `Evidence chainId must be ${config.chainId}, got ${manifest.chainId}`
    );
  }

  const verificationContracts = config.resolveContracts(manifest);
  await hre.run("compile");
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== config.chainId) {
    throw new Error(
      `RPC chainId must be ${config.chainId}, got ${network.chainId}`
    );
  }

  const retries = Number(
    process.env[config.verifyRetriesEnv] || config.defaultVerifyRetries
  );
  const retryDelayMs = Number(
    process.env[config.verifyRetryDelayEnv] || config.defaultVerifyRetryDelayMs
  );
  const verification = {
    contracts: await verifyContracts(
      verificationContracts,
      retries,
      retryDelayMs
    ),
  };

  const updatedReport = {
    ...report,
    verificationUpdatedAt: new Date().toISOString(),
    failed: appendVerificationFailures(
      report.failed || [],
      verification.contracts
    ),
    status:
      appendVerificationFailures(report.failed || [], verification.contracts)
        .length === 0
        ? "success"
        : "failed",
    chainName: config.chainName,
    chainId: Number(config.chainId),
    contracts: manifest.contracts,
  };

  writeEvidenceBundle(
    evidenceDir,
    {
      "verification.json": verification,
      "report.json": updatedReport,
    },
    renderUpdatedMarkdown(updatedReport, config)
  );

  console.log(
    `${config.chainName} verification evidence updated: ${evidenceDir}`
  );
  if (updatedReport.failed.length > 0) {
    for (const failure of updatedReport.failed) {
      console.error(`FATAL CONTRACT-VERIFY-001: ${failure}`);
    }
    process.exit(1);
  }
}

module.exports = {
  buildVerificationContract,
  runVerification,
};
