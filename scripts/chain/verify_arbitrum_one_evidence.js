const path = require("path");
const { runVerification } = require("./verify_arbitrum_evidence_common");

runVerification({
  chainId: 42161n,
  chainName: "Arbitrum One",
  explorerUrl: "https://arbiscan.io",
  evidenceRoot: path.resolve(
    __dirname,
    "..",
    "..",
    "docs",
    "evidence",
    "release",
    "contracts",
    "arbitrum-one",
  ),
  reportTitle: "Arbitrum One Contract Deployment Evidence",
  reportNotes: [
    "Production deploy uses the official Arbitrum One USDC address, not MockUSDC.",
    "Evidence intentionally excludes private keys, RPC API keys, raw signatures, JWTs, and admin tokens.",
    "Arbiscan verification uses Etherscan API V2 through the Hardhat verify plugin.",
  ],
  rpcEnv: "ARBITRUM_ONE_RPC_URL",
  explorerApiKeyEnvNames: ["ETHERSCAN_API_KEY", "ARBISCAN_API_KEY"],
  verifyRetriesEnv: "PROD_VERIFY_RETRIES",
  defaultVerifyRetries: 6,
  verifyRetryDelayEnv: "PROD_VERIFY_RETRY_DELAY_MS",
  defaultVerifyRetryDelayMs: 20000,
  mockUsdc: false,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
