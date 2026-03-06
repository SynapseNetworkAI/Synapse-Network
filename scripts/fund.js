const { ethers } = require("hardhat");

async function main() {
    const receiver = "0xd856907d7e35A8F9bD225859A59E58577147a092";
    const [sender] = await ethers.getSigners();
    
    console.log(`Funding account: ${receiver}`);
    console.log(`Sending ETH from: ${sender.address}`);
    
    const tx = await sender.sendTransaction({
        to: receiver,
        value: ethers.parseEther("100.0") // Sending 100 ETH
    });
    
    await tx.wait();
    
    console.log(`Successfully funded ${receiver} with 100 ETH!`);
    
    const balance = await ethers.provider.getBalance(receiver);
    console.log(`New balance: ${ethers.formatEther(balance)} ETH`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
