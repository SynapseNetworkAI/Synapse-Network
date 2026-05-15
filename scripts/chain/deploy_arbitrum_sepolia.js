const path = require("path");
const { runDeployment } = require("./deploy_arbitrum_common");

const CONFIG = {
  chainId: 421614n,
  chainName: "Arbitrum Sepolia",
  networkName: "arbitrumSepolia",
  environmentLabel: "staging",
  explorerUrl: "https://sepolia.arbiscan.io",
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
    "Explorer verification waits after deployment and retries bounded attempts to avoid indexing races.",
  ],
  rpcEnv: "ARBITRUM_SEPOLIA_RPC_URL",
  deployerPrivateKeyEnv: "STAGING_DEPLOYER_PRIVATE_KEY",
  ownerEnv: "STAGING_CONTRACT_OWNER_ADDRESS",
  withdrawSignerEnv: "STAGING_WITHDRAW_SIGNER_ADDRESS",
  explorerApiKeyEnvNames: ["ETHERSCAN_API_KEY", "ARBISCAN_API_KEY"],
  minGasEthEnv: "STAGING_MIN_GAS_ETH",
  confirmationsEnv: "STAGING_DEPLOY_CONFIRMATIONS",
  verifyDelayEnv: "STAGING_VERIFY_DELAY_MS",
  verifyRetriesEnv: "STAGING_VERIFY_RETRIES",
  verifyRetryDelayEnv: "STAGING_VERIFY_RETRY_DELAY_MS",
  defaultMinGasEth: "0.01",
  defaultConfirmations: 5,
  defaultVerifyDelayMs: 15000,
  defaultVerifyRetries: 5,
  defaultVerifyRetryDelayMs: 15000,
  mockUsdc: {
    consumerEnv: "STAGING_TEST_CONSUMER_ADDRESS",
    providerEnv: "STAGING_TEST_PROVIDER_ADDRESS",
    preMintEnv: "STAGING_TEST_MOCK_USDC_PREMINT",
    defaultPreMint: "100000",
  },
};

runDeployment(CONFIG).catch((error) => {
  console.error(error);
  process.exit(1);
});
