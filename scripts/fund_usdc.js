const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const configPath = path.join(__dirname, "../frontend/src/contract-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const usdcAddress = config.MockUSDC;
    const receiver = "0xd856907d7e35A8F9bD225859A59E58577147a092";
    const [deployer] = await hre.ethers.getSigners();
    
    console.log("Using MockUSDC at:", usdcAddress);
    console.log("Funding USDC to account:", receiver);
    
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const usdc = MockUSDC.attach(usdcAddress);
    
    // Fix: dynamically get decimals instead of hardcoding 6
    const decimals = await usdc.decimals();
    const amount = hre.ethers.parseUnits("1000", decimals);
    
    try {
        const tx = await usdc.connect(deployer).transfer(receiver, amount);
        await tx.wait();
        console.log(`Successfully transferred 1000 USDC (${decimals} decimals)`);
    } catch(e) {
        console.log("Transfer failed, trying mint...");
        const tx2 = await usdc.connect(deployer).mint(receiver, amount);
        await tx2.wait();
        console.log(`Successfully minted 1000 USDC (${decimals} decimals)`);
    }
    
    const bal = await usdc.balanceOf(receiver);
    console.log("Current Balance:", hre.ethers.formatUnits(bal, decimals), "USDC");
}

main().catch(console.error);
