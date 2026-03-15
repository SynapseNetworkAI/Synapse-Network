const hre = require("hardhat");
const contractConfig = require("../frontend/src/contract-config.json");

async function main() {
    const usdc = await hre.ethers.getContractAt("MockUSDC", contractConfig.MockUSDC);
    const routerAddress = "0x9876543210123456789012345678901234567890"; 
    
    // According to your Hardhat block logs, you triggered this from Platform/Account[0] 
    // which is 0xa0f67a... from test_accounts, but wait! The wagmi frontend probably 
    // connected via your metamask which is 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 
    // OR 0xa0f... Let's just check the one from your screenshot that *actually* sent the tx. 
    // We will scan BOTH just to be sure!

    const walletsToScan = [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // Hardhat 0 / Metamask
        "0xA0f67a47D9eF18183Cd113eD85A654E2772c5901", // test_accounts Platform!
    ];

    console.log("\n=========================================");
    console.log("MockUSDC Token: ", contractConfig.MockUSDC);
    console.log("Router合约(支出者): ", routerAddress);
    console.log("=========================================\n");

    for (const wallet of walletsToScan) {
        const allowance = await usdc.allowance(wallet, routerAddress);
        const bal = await usdc.balanceOf(wallet);
        const formatted = hre.ethers.formatUnits(allowance, 18);
        const balFormatted = hre.ethers.formatUnits(bal, 18);
        
        console.log(`钱包地址: ${wallet}`);
        console.log(`钱包 USDC 余额: ${balFormatted}`);
        console.log(`---> 已授权额度: ${formatted} USDC \n`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
