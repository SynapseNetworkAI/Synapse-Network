const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const CHAIN_ID = 421614n;
const CHAIN_NAME = "Arbitrum Sepolia";
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
const DEFAULT_VERIFY_RETRIES = 5;
const DEFAULT_VERIFY_RETRY_DELAY_MS = 15000;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env ${name}`);
  }
  return value.trim();
}

function resolveEvidenceDir() {
  if (process.env.CONTRACT_DEPLOYMENT_EVIDENCE_DIR) {
    return path.resolve(process.env.CONTRACT_DEPLOYMENT_EVIDENCE_DIR);
  }
  if (!fs.existsSync(EVIDENCE_ROOT)) {
    throw new Error(`Evidence root does not exist: ${EVIDENCE_ROOT}`);
  }
  const dirs = fs
    .readdirSync(EVIDENCE_ROOT)
    .map((entry) => path.join(EVIDENCE_ROOT, entry))
    .filter((entryPath) => fs.statSync(entryPath).isDirectory())
    .filter((entryPath) => fs.existsSync(path.join(entryPath, "contract-manifest.json")))
    .sort()
    .reverse();
  if (dirs.length === 0) {
    throw new Error(`No Arbitrum Sepolia evidence directories found in ${EVIDENCE_ROOT}`);
  }
  return dirs[0];
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
    `- Verification updated at: ${report.verificationUpdatedAt || "n/a"}`,
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
    "- Arbiscan verification uses Etherscan API V2 through the Hardhat verify plugin.",
  );

  return `${lines.join("\n")}\n`;
}

async function main() {
  requireEnv("ARBITRUM_SEPOLIA_RPC_URL");
  if (!process.env.ETHERSCAN_API_KEY && !process.env.ARBISCAN_API_KEY) {
    throw new Error("Missing ETHERSCAN_API_KEY or ARBISCAN_API_KEY for Etherscan API V2 verification");
  }

  const evidenceDir = resolveEvidenceDir();
  const manifestPath = path.join(evidenceDir, "contract-manifest.json");
  const verificationPath = path.join(evidenceDir, "verification.json");
  const reportPath = path.join(evidenceDir, "report.json");
  const reportMarkdownPath = path.join(evidenceDir, "report.md");

  const manifest = readJson(manifestPath);
  const report = readJson(reportPath);
  const mockUsdc = manifest.contracts?.mockUsdc;
  const synapseCore = manifest.contracts?.synapseCore;

  if (manifest.chainId !== Number(CHAIN_ID)) {
    throw new Error(`Evidence chainId must be ${CHAIN_ID}, got ${manifest.chainId}`);
  }
  if (!mockUsdc?.address || !synapseCore?.address) {
    throw new Error("Evidence manifest is missing MockUSDC or SynapseCore address");
  }

  await hre.run("compile");
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(`RPC chainId must be ${CHAIN_ID}, got ${network.chainId}`);
  }

  const retries = Number(process.env.STAGING_VERIFY_RETRIES || DEFAULT_VERIFY_RETRIES);
  const retryDelayMs = Number(
    process.env.STAGING_VERIFY_RETRY_DELAY_MS || DEFAULT_VERIFY_RETRY_DELAY_MS,
  );
  const verification = {
    contracts: [
      await verifyWithRetry({
        contractName: "MockUSDC",
        address: mockUsdc.address,
        constructorArguments: mockUsdc.constructorArgs || [manifest.deployer],
        retries,
        retryDelayMs,
      }),
      await verifyWithRetry({
        contractName: "SynapseCore",
        address: synapseCore.address,
        constructorArguments: synapseCore.constructorArgs || [
          mockUsdc.address,
          manifest.withdrawSigner,
          manifest.owner,
        ],
        retries,
        retryDelayMs,
      }),
    ],
  };

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
    chainName: CHAIN_NAME,
    chainId: Number(CHAIN_ID),
    contracts: manifest.contracts,
  };

  writeJson(verificationPath, verification);
  writeJson(reportPath, updatedReport);
  fs.writeFileSync(reportMarkdownPath, reportMarkdown(updatedReport));

  console.log(`Arbitrum Sepolia verification evidence updated: ${evidenceDir}`);
  if (failed.length > 0) {
    for (const failure of failed) {
      console.error(`FATAL CONTRACT-VERIFY-001: ${failure}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
