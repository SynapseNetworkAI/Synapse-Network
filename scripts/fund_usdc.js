const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const configPath = path.join(__dirname, "../frontend/src/contract-config.json");
    const testAccountsPath = path.join(__dirname, "test_accounts.json");
    
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const accounts = JSON.parse(fs.readFileSync(testAccountsPath, "utf8"));
    
    const usdcAddress = config.MockUSDC;
    const signers = await hre.ethers.getSigners();
    const deployer = signers[0];
    
    console.log("Using MockUSDC at:", usdcAddress);
    
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const usdc = MockUSDC.attach(usdcAddress);
    
    const decimals = await usdc.decimals();
    const amount = hre.ethers.parseUnits("1000", decimals);
    
    for (const account of accounts) {
        const receiver = account.address;
        console.log(`Funding USDC to ${account.name} (Address: ${receiver})`);
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
        console.log(`Current Balance: ${hre.ethers.formatUnits(bal, decimals)} USDC\n`);
    }
}

main().catch(console.error);
