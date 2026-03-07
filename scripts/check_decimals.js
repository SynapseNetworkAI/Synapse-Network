const { ethers } = require("hardhat");
const fs = require('fs');

async function main() {
  const config = JSON.parse(fs.readFileSync("./frontend/src/contract-config.json", "utf8"));
  const USDC = await ethers.getContractAt("MockUSDC", config.MockUSDC);
  const dec = await USDC.decimals();
  console.log("MockUSDC Decimals:", dec);
}
main().catch(console.error);
