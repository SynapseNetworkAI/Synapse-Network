const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // 1. Deploy Mock USDC
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log("Mock USDC deployed to:", usdcAddress);

  // 2. Deploy Sync Router (set deployer as protocol treasury, 100 = 1% fee)
  const A2APaySyncRouter = await hre.ethers.getContractFactory("A2APaySyncRouter");
  const syncRouter = await A2APaySyncRouter.deploy(deployer.address, 100);
  await syncRouter.waitForDeployment();
  const syncRouterAddress = await syncRouter.getAddress();
  console.log("A2APaySyncRouter deployed to:", syncRouterAddress);

  /* (Deprecated Escrow Mode)
  const Escrow = await hre.ethers.getContractFactory("AgentPayEscrow");
  const escrow = await Escrow.deploy(usdcAddress, deployer.address);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("Escrow deployed to:", escrowAddress);
  */

  // 3. Deploy Smart Wallet (human owner)
  const SmartWallet = await hre.ethers.getContractFactory("AgentSmartWallet");
  const wallet = await SmartWallet.deploy(deployer.address);
  await wallet.waitForDeployment();
  const walletAddress = await wallet.getAddress();
  console.log("Smart Wallet deployed to:", walletAddress);

  // 4. Save to Frontend
  const config = {
    MockUSDC: usdcAddress,
    A2APaySyncRouter: syncRouterAddress,
    SmartWallet: walletAddress,
    Treasury: deployer.address
  };
  
  const frontendSrc = path.join(__dirname, "../frontend/src");
  if (!fs.existsSync(frontendSrc)){
      fs.mkdirSync(frontendSrc, { recursive: true });
  }

  fs.writeFileSync(
    path.join(frontendSrc, "contract-config.json"),
    JSON.stringify(config, null, 2)
  );

  const routerArt = await hre.artifacts.readArtifact("A2APaySyncRouter");
  fs.writeFileSync(path.join(frontendSrc, "A2APaySyncRouterABI.json"), JSON.stringify(routerArt.abi, null, 2));

  // Also copying to python_sdk so backend can parse events
  const pythonSdk = path.join(__dirname, "../python_sdk");
  fs.writeFileSync(path.join(pythonSdk, "A2APaySyncRouterABI.json"), JSON.stringify(routerArt.abi, null, 2));

  const walletArt = await hre.artifacts.readArtifact("AgentSmartWallet");
  fs.writeFileSync(path.join(frontendSrc, "WalletABI.json"), JSON.stringify(walletArt.abi, null, 2));
  
  const usdcArt = await hre.artifacts.readArtifact("MockUSDC");
  fs.writeFileSync(path.join(frontendSrc, "MockUSDCABI.json"), JSON.stringify(usdcArt.abi, null, 2));
  
  console.log("ABIs and Config exported to Next.js frontend and Python SDK!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
