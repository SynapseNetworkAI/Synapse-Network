const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const configPath = path.join(__dirname, "test_accounts.json");
    const accounts = JSON.parse(fs.readFileSync(configPath, "utf8"));
    
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
