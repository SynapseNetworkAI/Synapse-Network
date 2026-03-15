const { ethers } = require("hardhat");
const fs = require('fs');

async function main() {
  const configPath = "./frontend/src/contract-config.json";
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const usdcAddress = config.MockUSDC;
  
  const targetAddress = "0xd856907d7e35A8F9bD225859A59E58577147a092";

  console.log("MockUSDC Address:", usdcAddress);
  console.log("Checking balance for:", targetAddress);

  const USDC = await ethers.getContractAt("MockUSDC", usdcAddress);
  
  try {
      const balance = await USDC.balanceOf(targetAddress);
      console.log("Balance:", ethers.formatUnits(balance, 6), "USDC");
  } catch (e) {
      console.error("Error reading balance. Contract might not exist or node restarted.");
      console.error(e.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
