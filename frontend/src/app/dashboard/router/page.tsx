"use client";
import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import contractConfig from "@/contract-config.json";

const erc20ABI = [
  {
    "constant": false,
    "inputs": [
      { "name": "spender", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "name": "approve",
    "outputs": [{ "name": "", "type": "bool" }],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

const FUND_ROUTER_ADDRESS = "0x9876543210123456789012345678901234567890"; // Demo router address

export default function RouterPage() {
  const { isConnected } = useAccount();
  const [amount, setAmount] = useState("500");
  const [dailyLimit, setDailyLimit] = useState("50");
  const { data: hash, writeContract, isPending, error } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const handleApprove = () => {
    writeContract({
      address: contractConfig.MockUSDC as `0x${string}`,
      abi: erc20ABI,
      functionName: "approve",
      args: [FUND_ROUTER_ADDRESS as `0x${string}`, parseUnits(amount, 6)],
    });
  };

  const handleSetDailyLimit = () => {
    writeContract({
      address: FUND_ROUTER_ADDRESS as `0x${string}`,
      abi: [{ "type": "function", "name": "setDailyLimit", "inputs": [{"name": "_limit", "type": "uint256"}], "outputs": [], "stateMutability": "nonpayable" }],
      functionName: "setDailyLimit",
      args: [parseUnits(dailyLimit, 6)],
    });
  };

  return (
    <div className="max-w-4xl p-8 mx-auto">
      <h1 className="mb-6 text-3xl font-bold text-green-400">Phase 18: Smart Contract Relayer Setup</h1>
      <p className="py-2 pl-4 mb-4 text-gray-400 border-l-4 border-green-500">
        Enable Auto Top-up for your agent fleet by binding your Master Wallet. 
        You will sign an <code>Approve</code> transaction allowing the A2A_FundRouter to deduct up to your specified allowance.
      </p>
      
      <div className="p-4 mb-8 border rounded-lg border-blue-900/50 bg-blue-900/10">
        <h3 className="flex items-center mb-2 font-bold text-blue-400">
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          Why Daily Limits Matter (Security Upgrade)
        </h3>
        <p className="text-sm leading-relaxed text-blue-200/80">
          Standard ERC20 Allowances are vulnerable: if a relayer is compromised, an attacker could drain your entire approved balance in seconds. 
          To provide enterprise-grade security, our <strong>A2A Fund Router</strong> enforces a strict on-chain <strong>Daily Spending Limit</strong>. 
          Even if you approve a large total allowance (e.g., 100,000 USDC) to avoid frequent gas fees, the smart contract mathematically guarantees that no more than your specified <strong>Daily Limit</strong> (e.g., 500 USDC) can be withdrawn within any 24-hour epoch.
        </p>
      </div>

      <div className="p-6 mb-8 bg-gray-900 border border-gray-800 rounded-lg">
        <h2 className="mb-4 text-xl font-semibold text-white">1. Connect Master Wallet</h2>
        <div className="mb-4">
           <ConnectButton />
        </div>
        {!isConnected && <p className="mt-2 text-sm text-yellow-500">Please connect a wallet to proceed.</p>}
      </div>

      <div className={`bg-gray-900 border ${isConnected ? "border-green-800" : "border-gray-800 opacity-50"} rounded-lg p-6`}>
        <h2 className="mb-4 text-xl font-semibold text-white">2. Set Allowance Threshold</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-400">Max Allowance (USDC)</label>
            <input 
              type="number" 
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!isConnected}
              className="w-full max-w-md p-2 text-white bg-black border border-gray-700 rounded"
            />
            <p className="mt-1 text-xs text-gray-500">The maximum amount the Router can automatically move to your Sub-accounts.</p>
          </div>

          <button
            onClick={handleApprove}
            disabled={!isConnected || isPending}
            className="px-6 py-2 font-bold text-white transition-colors bg-green-600 rounded hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Waiting for Wallet..." : "Approve Router"}
          </button>

          {hash && (
            <div className="p-4 mt-4 break-all bg-black border border-gray-800 rounded">
               <p className="text-sm text-gray-400">Transaction Hash:</p>
               <p className="font-mono text-xs text-green-400">{hash}</p>
            </div>
          )}
          
          {isConfirming && <p className="mt-2 text-sm text-yellow-400">Waiting for confirmation...</p>}
          {isConfirmed && <p className="mt-2 text-sm font-bold text-green-400">✅ Approval Confirmed! Router is now active.</p>}
          {error && <p className="mt-2 text-sm text-red-500">Error: {(error as {shortMessage?: string}).shortMessage || error.message}</p>}
        </div>

      <div className={`mt-8 bg-gray-900 border ${isConnected ? "border-blue-800" : "border-gray-800 opacity-50"} rounded-lg p-6`}>
        <h2 className="mb-4 text-xl font-semibold text-white">3. Configure Daily Limit</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-400">Max Daily Spending (USDC)</label>
            <input 
              type="number" 
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              disabled={!isConnected}
              className="w-full max-w-md p-2 text-white bg-black border border-gray-700 rounded focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">The Router contract will actively block any extraction exceeding this daily threshold, regardless of your total allowance.</p>
          </div>

          <button
            onClick={handleSetDailyLimit}
            disabled={!isConnected || isPending}
            className="px-6 py-2 font-bold text-white transition-colors bg-blue-600 rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Waiting for Wallet..." : "Set Daily Limit"}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
