const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Starting Anvil Deployment...");

  // 获取部署账号和其他角色账号
  const signers = await hre.ethers.getSigners();
  const owner = signers[0];
  const backendSigner = signers[1]; // 用于 Python 后端开赛博银票 (EIP-712签名)

  console.log("=================================================");
  console.log("Owner (Admin) Address   :", owner.address);
  console.log("Backend Signer Address :", backendSigner.address);
  console.log("=================================================\n");

  // 1. 部署支持 ERC20Permit 的 MockUSDC
  console.log("Deploying MockUSDC (with ERC20Permit)...");
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();
  const usdcAddress = await mockUSDC.getAddress();
  console.log("✅ MockUSDC deployed to:", usdcAddress);

  // 2. 部署 A2APayVault 核心金库合约
  console.log("\nDeploying A2APayVault...");
  const A2APayVault = await hre.ethers.getContractFactory("A2APayVault");
  // constructor(address _usdc, address _signer, address _initialOwner)
  const vault = await A2APayVault.deploy(
    usdcAddress,
    backendSigner.address, // 设置网关签名验证地址
    owner.address          // 最高管理员
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("✅ A2APayVault deployed to:", vaultAddress);

  // 3. (可选) 给测试账号 Mint 一点 USDC 方便前端联调
  console.log("\nMinting initial USDC to Owner...");
  await mockUSDC.mint(owner.address, hre.ethers.parseUnits("10000", 18));
  console.log("✅ Minted 10000 USDC");

  // 4. 更新前端配置表 contract-config.json
  console.log("\nUpdating Frontend Config...");
  const configPath = path.join(__dirname, "../frontend/src/contract-config.json");
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }

  // 覆盖这两个关键地址，保留可能存在的其他的配置如 A2APaySyncRouter
  config.MockUSDC = usdcAddress;
  config.A2APayVault = vaultAddress;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log("✅ Successfully updated frontend/src/contract-config.json!");
  
  console.log("\n=================== 部署完毕 ===================");
  console.log("IMPORTANT: 给 Python 后端用到的环境变量：");
  console.log(`VAULT_CONTRACT_ADDRESS="${vaultAddress}"`);
  console.log(`USDC_CONTRACT_ADDRESS="${usdcAddress}"`);
  console.log("请记得将 backendSigner (- 即 Hardhat 第 2 个号) 的私钥放入 Python 后端用于签名!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
