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

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-green-400 mb-6">Phase 18: Smart Contract Relayer Setup</h1>
      <p className="text-gray-400 mb-8 border-l-4 border-green-500 pl-4 py-2">
        Enable Auto Top-up for your agent fleet by binding your Master Wallet. 
        You will sign an <code>Approve</code> transaction allowing the A2A_FundRouter to deduct up to your specified allowance.
      </p>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4 text-white">1. Connect Master Wallet</h2>
        <div className="mb-4">
           <ConnectButton />
        </div>
        {!isConnected && <p className="text-sm text-yellow-500 mt-2">Please connect a wallet to proceed.</p>}
      </div>

      <div className={`bg-gray-900 border ${isConnected ? "border-green-800" : "border-gray-800 opacity-50"} rounded-lg p-6`}>
        <h2 className="text-xl font-semibold mb-4 text-white">2. Set Allowance Threshold</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Max Allowance (USDC)</label>
            <input 
              type="number" 
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!isConnected}
              className="bg-black border border-gray-700 rounded p-2 text-white w-full max-w-md"
            />
            <p className="mt-1 text-xs text-gray-500">The maximum amount the Router can automatically move to your Sub-accounts.</p>
          </div>

          <button
            onClick={handleApprove}
            disabled={!isConnected || isPending}
            className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-6 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Waiting for Wallet..." : "Approve Router"}
          </button>

          {hash && (
            <div className="mt-4 p-4 bg-black rounded border border-gray-800 break-all">
               <p className="text-sm text-gray-400">Transaction Hash:</p>
               <p className="text-xs text-green-400 font-mono">{hash}</p>
            </div>
          )}
          
          {isConfirming && <p className="text-sm text-yellow-400 mt-2">Waiting for confirmation...</p>}
          {isConfirmed && <p className="text-sm text-green-400 mt-2 font-bold">✅ Approval Confirmed! Router is now active.</p>}
          {error && <p className="text-sm text-red-500 mt-2">Error: {(error as any).shortMessage || error.message}</p>}
        </div>
      </div>
    </div>
  );
}
