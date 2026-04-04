const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function parseCliAddresses() {
  return process.argv.filter((arg) => /^0x[a-fA-F0-9]{40}$/.test(arg));
}

async function main() {
  let addresses = parseCliAddresses();

  if (addresses.length === 0 && process.env.TARGET_WALLET) {
    addresses = process.env.TARGET_WALLET.split(",")
      .map((value) => value.trim())
      .filter((value) => /^0x[a-fA-F0-9]{40}$/.test(value));
  }

  if (addresses.length === 0) {
    console.error("Usage: TARGET_WALLET=0x... npx hardhat run scripts/fund_current_wallet.js --network localhost");
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const configPath = path.join(repoRoot, "apps", "frontend", "src", "contract-config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(`contract-config.json not found at ${configPath}. Run deploy_anvil.js first.`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!config.MockUSDC) {
    throw new Error("MockUSDC address missing in services/user-front/src/contract-config.json");
  }

  const [sender] = await hre.ethers.getSigners();
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const usdc = MockUSDC.attach(config.MockUSDC);
  const decimals = await usdc.decimals();
  const ethAmount = hre.ethers.parseEther("10");
  const usdcAmount = hre.ethers.parseUnits("1000", decimals);

  console.log(`Funding from signer: ${sender.address}`);
  console.log(`Using MockUSDC at : ${config.MockUSDC}\n`);

  for (const address of addresses) {
    console.log(`Funding wallet: ${address}`);

    const ethTx = await sender.sendTransaction({
      to: address,
      value: ethAmount,
    });
    await ethTx.wait();

    try {
      const usdcTx = await usdc.connect(sender).transfer(address, usdcAmount);
      await usdcTx.wait();
    } catch (error) {
      console.log("Transfer failed, trying mint...");
      const mintTx = await usdc.connect(sender).mint(address, usdcAmount);
      await mintTx.wait();
    }

    const ethBalance = await hre.ethers.provider.getBalance(address);
    const usdcBalance = await usdc.balanceOf(address);

    console.log(`ETH balance : ${hre.ethers.formatEther(ethBalance)} ETH`);
    console.log(`USDC balance: ${hre.ethers.formatUnits(usdcBalance, decimals)} MockUSDC\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
