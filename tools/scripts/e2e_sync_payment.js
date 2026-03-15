const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const configPath = path.join(repoRoot, "apps/frontend/src/contract-config.json");
  const routerAbiPath = path.join(repoRoot, "apps/frontend/src/SynapseCoreABI.json");
  const usdcAbiPath = path.join(repoRoot, "apps/frontend/src/MockUSDCABI.json");

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const routerAbi = JSON.parse(fs.readFileSync(routerAbiPath, "utf8"));
  const usdcAbi = JSON.parse(fs.readFileSync(usdcAbiPath, "utf8"));

  const [deployer, buyer] = await hre.ethers.getSigners();

  const usdc = new hre.ethers.Contract(config.MockUSDC, usdcAbi, deployer);
  const router = new hre.ethers.Contract(config.SynapseCore, routerAbi, buyer);

  const amount = hre.ethers.parseUnits("1", 18);
  const serviceId = "V1_DEMO";

  await (await usdc.mint(buyer.address, amount)).wait();
  await (await usdc.connect(buyer).approve(config.SynapseCore, amount)).wait();

  const tx = await router.payForService(config.MockUSDC, config.Treasury, amount, serviceId);
  const receipt = await tx.wait();

  console.log(`BUYER=${buyer.address}`);
  console.log(`SELLER=${config.Treasury}`);
  console.log(`SERVICE_ID=${serviceId}`);
  console.log(`AMOUNT_WEI=${amount.toString()}`);
  console.log(`TX_HASH=${receipt.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
