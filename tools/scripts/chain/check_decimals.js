const { ethers } = require("hardhat");
const fs = require('fs');
const path = require("path");

async function main() {
  const configPath = path.resolve(__dirname, "..", "..", "..", "services/user-front/src/contract-config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const USDC = await ethers.getContractAt("MockUSDC", config.MockUSDC);
  const dec = await USDC.decimals();
  console.log("MockUSDC Decimals:", dec);
}
main().catch(console.error);
