const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const configPath = path.join(repoRoot, "services/user-front/src/contract-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    
    let accounts = [];
    
    // Check if user provided addresses via command line arguments (e.g. 0x123...)
    const cliAddresses = process.argv.filter(arg => arg.startsWith('0x') && (arg.length === 42 || arg.length === 66));
    if (cliAddresses.length > 0) {
        accounts = cliAddresses.map((addr, idx) => ({ name: `CLI_Account_${idx+1}`, address: addr }));
        console.log("Using addresses provided via command line.");
    } else {
        const testAccountsPath = path.join(__dirname, "test_usdc_accounts.json");
        if (fs.existsSync(testAccountsPath)) {
            accounts = JSON.parse(fs.readFileSync(testAccountsPath, "utf8"));
            console.log("Using addresses from test_usdc_accounts.json.");
        } else {
            console.warn("No test_usdc_accounts.json found, and no addresses provided via CLI.");
            return;
        }
    }
    
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
