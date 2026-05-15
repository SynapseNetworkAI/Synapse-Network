const path = require("path");
const { runVerification } = require("./verify_arbitrum_evidence_common");

runVerification({
  chainId: 421614n,
  chainName: "Arbitrum Sepolia",
  explorerUrl: "https://sepolia.arbiscan.io",
  evidenceRoot: path.resolve(
    __dirname,
    "..",
    "..",
    "docs",
    "evidence",
    "release",
    "contracts",
    "arbitrum-sepolia",
  ),
  reportTitle: "Arbitrum Sepolia Contract Deployment Evidence",
  reportNotes: [
    "Staging uses owner-only MockUSDC, not real USDC.",
    "Evidence intentionally excludes private keys, RPC API keys, raw signatures, JWTs, and admin tokens.",
    "Arbiscan verification uses Etherscan API V2 through the Hardhat verify plugin.",
  ],
  rpcEnv: "ARBITRUM_SEPOLIA_RPC_URL",
  explorerApiKeyEnvNames: ["ETHERSCAN_API_KEY", "ARBISCAN_API_KEY"],
  verifyRetriesEnv: "STAGING_VERIFY_RETRIES",
  defaultVerifyRetries: 5,
  verifyRetryDelayEnv: "STAGING_VERIFY_RETRY_DELAY_MS",
  defaultVerifyRetryDelayMs: 15000,
  mockUsdc: true,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
