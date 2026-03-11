import * as fs from 'fs';

const filePath = '/Users/cliff/workspace/A2A-pay/frontend/src/app/dashboard/console/page.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add write contract for mint
content = content.replace(
  `const { data: hash, writeContractAsync, isPending } = useWriteContract();`,
  `const { data: hash, writeContractAsync, isPending } = useWriteContract();\n  const { writeContractAsync: writeMintAsync, isPending: isMinting } = useWriteContract();`
);

// 2. Add handleMint function
const handleMintCode = `
  const handleMint = async () => {
    if (!address) return;
    try {
      await writeMintAsync({
        address: contractConfig.MockUSDC as \`0x\${string}\`,
        abi: parseAbi(["function mint(address,uint256)"]),
        functionName: "mint",
        args: [address, parseUnits("100", 18)],
      });
      toast.success("Transaction sent. Requesting 100 Mock USDC...");
    } catch (err: any) {
      if (err?.message?.includes("User rejected") || err?.message?.toLowerCase().includes("rejected")) {
        toast("Transaction cancelled by user", { icon: "ℹ️" });
      } else {
        toast.error("Failed to mint USDC: " + String(err));
      }
    }
  };
`;

content = content.replace(`const handleTopUp = async () => {`, handleMintCode + '\n  const handleTopUp = async () => {');

// 3. Improve handleTopUp error handling
content = content.replace(
  `toast.error(err instanceof Error ? err instanceof Error ? err instanceof Error ? err.message : String(err) : String(err) : String(err) || "Failed to top up");`,
  `const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User rejected") || msg.toLowerCase().includes("rejected")) {
        toast("Sign/Transaction cancelled by user", { icon: "ℹ️" });
      } else if (msg.includes("Insufficient Balance") || msg.includes("insufficient funds") || msg.includes("gas required exceeds allowance")) {
        toast.error("USDC 余额不足，请点击获取测试币", { duration: 5000 });
      } else {
        toast.error("Failed to top up: " + msg);
      }`
);

// 4. Add the faucet button in UI
content = content.replace(
  `<button\n                onClick={() => setIsTopUpOpen(true)}`,
  `<button
                onClick={handleMint}
                disabled={isMinting}
                className="flex items-center px-4 py-2 mr-3 text-sm font-bold text-blue-900 transition-colors bg-blue-400 hover:bg-blue-300 rounded-xl"
              >
                {isMinting ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : "💧 "}
                Faucet: Get 100 USDC 
              </button>
              <button
                onClick={() => setIsTopUpOpen(true)}`
);

fs.writeFileSync(filePath, content);
console.log('Script done!');