const fs = require("fs");
const path = require("path");

require("@nomicfoundation/hardhat-toolbox");

const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

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
  const repoRoot = __dirname;
  const explicit = (process.env.ENV_FILE || "").trim();
  const candidates = [];

  if (explicit) {
    candidates.push(
      path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit),
      path.resolve(repoRoot, "services", "gateway", explicit),
    );
  }

  const environment = (process.env.ENVIRONMENT || "").trim().toLowerCase();
  if (environment) {
    candidates.push(
      path.resolve(repoRoot, `.env.${environment}`),
      path.resolve(repoRoot, "services", "gateway", `.env.${environment}`),
    );
  }

  if (process.argv.includes("arbitrumSepolia")) {
    candidates.push(
      path.resolve(repoRoot, ".env.staging"),
      path.resolve(repoRoot, "services", "gateway", ".env.staging"),
    );
  }

  candidates.push(
    path.resolve(repoRoot, ".env"),
    path.resolve(repoRoot, "services", "gateway", ".env"),
  );

  return [...new Set(candidates)];
}

for (const candidate of resolveEnvCandidates()) {
  applyEnvFile(candidate);
}

function resolvePrivateKeyAccounts(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value && /^0x[0-9a-fA-F]{64}$/.test(value.trim())) {
      return [value.trim()];
    }
  }
  return [];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun"
    }
  },
  networks: {
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC_URL || "http://127.0.0.1:8545",
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      accounts: resolvePrivateKeyAccounts("STAGING_DEPLOYER_PRIVATE_KEY"),
    },
  },
  etherscan: {
    // Etherscan API V2 uses one Etherscan.io key across supported chains.
    apiKey: process.env.ETHERSCAN_API_KEY || process.env.ARBISCAN_API_KEY || "",
    customChains: [
      {
        network: "arbitrumSepolia",
        chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://sepolia.arbiscan.io",
        },
      },
    ],
  },
};
