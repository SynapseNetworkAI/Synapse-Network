const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("Scanning testnet accounts...");
    const signers = await ethers.getSigners();
    
    // Default Anvil / Hardhat first 3 accounts
    const accounts = [
        {
            name: "Platform",
            address: signers[0].address // Typically the deployer/owner
        },
        {
            name: "buyerAgent",
            address: signers[1].address
        },
        {
            name: "sellerAgent",
            address: signers[2].address
        }
    ];

    const jsonContent = JSON.stringify(accounts, null, 2);

    const ethPath = path.join(__dirname, "test_eth_accounts.json");
    fs.writeFileSync(ethPath, jsonContent);
    console.log(`Saved to ${ethPath}`);

    const usdcPath = path.join(__dirname, "test_usdc_accounts.json");
    fs.writeFileSync(usdcPath, jsonContent);
    console.log(`Saved to ${usdcPath}`);

    console.log("\nAccounts discovered:");
    accounts.forEach(acc => console.log(`- ${acc.name}: ${acc.address}`));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
