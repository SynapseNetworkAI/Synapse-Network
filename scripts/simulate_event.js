const hre = require("hardhat");

async function main() {
  const config = require("../frontend/src/contract-config.json");
  const [deployer, buyer, seller] = await hre.ethers.getSigners();
  
  const USDC = await hre.ethers.getContractAt("MockUSDC", config.MockUSDC);
  const Escrow = await hre.ethers.getContractAt("AgentPayEscrow", config.Escrow);

  console.log("Simulating an AI Agent transaction on-chain...");

  // Transfer some USDC to buyer
  await USDC.mint(buyer.address, hre.ethers.parseUnits("100", 18));
  
  // Buyer approves Escrow
  const amount = hre.ethers.parseUnits("50", 18);
  await USDC.connect(buyer).approve(config.Escrow, amount);

  // Generate a random task ID
  const taskId = hre.ethers.hexlify(hre.ethers.randomBytes(32));

  // Lock funds
  console.log("Buyer Agent locking 50 USDC for Seller Agent...");
  let tx = await Escrow.connect(buyer).lockFunds(taskId, seller.address, amount);
  await tx.wait();
  console.log("Funds Locked!");

  // Wait a sec
  await new Promise(r => setTimeout(r, 2000));

  // Release funds
  console.log("Seller Agent delivered work. Releasing funds...");
  tx = await Escrow.connect(buyer).releaseFunds(taskId);
  await tx.wait();
  console.log("Funds Released! Treasury took 2.5% cut.");
}

main().catch(console.error);
