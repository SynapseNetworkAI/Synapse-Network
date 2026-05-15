const path = require("path");
const {
  buildVerificationContract,
  runVerification,
} = require("./verify_arbitrum_evidence_common");

const CONFIG = {
  chainId: 421614n,
  chainName: "Arbitrum Sepolia",
  evidenceRoot: path.resolve(
    __dirname,
    "..",
    "..",
    "docs",
    "evidence",
    "release",
    "contracts",
    "arbitrum-sepolia"
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
  verifyRetryDelayEnv: "STAGING_VERIFY_RETRY_DELAY_MS",
  defaultVerifyRetries: 5,
  defaultVerifyRetryDelayMs: 15000,
  contractSummary(contracts) {
    return [
      `- MockUSDC: ${contracts?.mockUsdc?.address || "not deployed"}`,
      `- SynapseCore: ${contracts?.synapseCore?.address || "not deployed"}`,
    ];
  },
  resolveContracts(manifest) {
    const mockUsdc = manifest.contracts?.mockUsdc;
    const synapseCore = manifest.contracts?.synapseCore;
    if (!mockUsdc?.address || !synapseCore?.address) {
      throw new Error(
        "Evidence manifest is missing MockUSDC or SynapseCore address"
      );
    }
    return [
      buildVerificationContract(
        "MockUSDC",
        mockUsdc.address,
        mockUsdc.constructorArgs || [manifest.deployer],
        "https://sepolia.arbiscan.io"
      ),
      buildVerificationContract(
        "SynapseCore",
        synapseCore.address,
        synapseCore.constructorArgs || [
          mockUsdc.address,
          manifest.withdrawSigner,
          manifest.owner,
        ],
        "https://sepolia.arbiscan.io"
      ),
    ];
  },
};

runVerification(CONFIG).catch((error) => {
  console.error(error);
  process.exit(1);
});
