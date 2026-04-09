const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    let accounts = [];
    
    // Check if user provided addresses via command line arguments (e.g. 0x123...)
    const cliAddresses = process.argv.filter(arg => arg.startsWith('0x') && (arg.length === 42 || arg.length === 66));
    if (cliAddresses.length > 0) {
        accounts = cliAddresses.map((addr, idx) => ({ name: `CLI_Account_${idx+1}`, address: addr }));
        console.log("Using addresses provided via command line.");
    } else {
        const configPath = path.join(__dirname, "test_eth_accounts.json");
        if (fs.existsSync(configPath)) {
            accounts = JSON.parse(fs.readFileSync(configPath, "utf8"));
            console.log("Using addresses from test_eth_accounts.json.");
        } else {
            console.warn("No test_eth_accounts.json found, and no addresses provided via CLI.");
            return;
        }
    }
    
    const [sender] = await ethers.getSigners();
    console.log(`Sending ETH from: ${sender.address}\n`);
    
    for (const account of accounts) {
        console.log(`Funding ${account.name} (Address: ${account.address})`);
        const tx = await sender.sendTransaction({
            to: account.address,
            value: ethers.parseEther("10.0") // Sending 10 ETH
        });
        await tx.wait();
        console.log(`Successfully funded ${account.address} with 10 ETH!`);
        
        const balance = await ethers.provider.getBalance(account.address);
        console.log(`New balance: ${ethers.formatEther(balance)} ETH\n`);
    }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
