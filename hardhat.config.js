require("@nomicfoundation/hardhat-toolbox");

const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

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
      accounts: process.env.STAGING_DEPLOYER_PRIVATE_KEY
        ? [process.env.STAGING_DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },
  etherscan: {
    apiKey: {
      arbitrumSepolia: process.env.ARBISCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "arbitrumSepolia",
        chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io",
        },
      },
    ],
  },
};
