"use client";
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import contractConfig from "@/contract-config.json";
import { getRouterConfig, saveRouterConfig } from "@/utils/routerConfigApi";

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

const ROUTER_ADDRESS = contractConfig.A2APaySyncRouter as `0x${string}`;

export default function RouterPage() {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("500");
  const [dailyLimit, setDailyLimit] = useState("50");
  const [isSavingDailyLimit, setIsSavingDailyLimit] = useState(false);
  const [dailyLimitUpdatedAt, setDailyLimitUpdatedAt] = useState<number | null>(null);
  const { data: hash, writeContract, isPending, error } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  useEffect(() => {
    if (isConfirmed) {
      localStorage.setItem("routerSetupComplete", "true");
      toast.success("Allowance confirmed on-chain");
    }
  }, [isConfirmed]);

  useEffect(() => {
    if (!isConnected || !address) return;

    let cancelled = false;
    const loadConfig = async () => {
      try {
        const config = await getRouterConfig(address);
        if (!cancelled) {
          setDailyLimit(String(config.dailyLimitUsdc || 0));
          setDailyLimitUpdatedAt(typeof config.updatedAt === "number" ? config.updatedAt : null);
        }
      } catch {
      }
    };

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);


  const handleApprove = () => {
    writeContract({
      address: contractConfig.MockUSDC as `0x${string}`,
      abi: erc20ABI,
      functionName: "approve",
      args: [ROUTER_ADDRESS, parseUnits(amount, 18)],
    });
  };

  const handleSaveDailyLimit = async () => {
    if (!isConnected || !address) return;

    const nextDailyLimit = Number(dailyLimit);
    if (!Number.isFinite(nextDailyLimit) || nextDailyLimit < 0) {
      toast.error("Daily limit must be a number >= 0");
      return;
    }

    setIsSavingDailyLimit(true);
    try {
      const config = await saveRouterConfig(address, nextDailyLimit);
      setDailyLimit(String(config.dailyLimitUsdc));
      setDailyLimitUpdatedAt(typeof config.updatedAt === "number" ? config.updatedAt : null);
      localStorage.setItem("routerSetupComplete", "true");
      toast.success("Daily limit saved to platform policy");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save daily limit");
    } finally {
      setIsSavingDailyLimit(false);
    }
  };

  return (
    <div className="max-w-4xl p-8 mx-auto">
      <h1 className="mb-6 text-3xl font-bold text-green-400">Phase 18: Smart Contract Relayer Setup</h1>
      <p className="py-2 pl-4 mb-4 text-gray-400 border-l-4 border-green-500">
        Set two controls separately: total allowance is approved on-chain to the Router contract, while daily limit is saved as platform policy.
      </p>
      
      <div className="p-4 mb-8 border rounded-lg border-blue-900/50 bg-blue-900/10">
        <h3 className="flex items-center mb-2 font-bold text-blue-400">
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          Why Daily Limits Matter (Security Upgrade)
        </h3>
        <p className="text-sm leading-relaxed text-blue-200/80">
          According to V2 policy, allowance and daily policy are decoupled: allowance controls the upper bound approved to the Router smart contract, while daily limit is enforced by platform configuration before off-chain charging.
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
            <label htmlFor="router-allowance" className="block mb-1 text-sm font-medium text-gray-400">Max Allowance (USDC)</label>
            <input 
              id="router-allowance"
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

          <p className="text-xs text-gray-500">Allowance is an on-chain ERC20 approve transaction and takes effect after chain confirmation.</p>

          {hash && (
            <div className="p-4 mt-4 break-all bg-black border border-gray-800 rounded">
               <p className="text-sm text-gray-400">Transaction Hash:</p>
               <p className="font-mono text-xs text-green-400">{hash}</p>
            </div>
          )}
          
          {isConfirming && <p className="mt-2 text-sm text-yellow-400">Waiting for confirmation...</p>}
          {isConfirmed && <p className="mt-2 text-sm font-bold text-green-400">✅ On-chain allowance confirmed.</p>}
          {error && <p className="mt-2 text-sm text-red-500">Error: {(error as {shortMessage?: string}).shortMessage || error.message}</p>}
        </div>

      <div className={`mt-8 bg-gray-900 border ${isConnected ? "border-blue-800" : "border-gray-800 opacity-50"} rounded-lg p-6`}>
        <h2 className="mb-4 text-xl font-semibold text-white">3. Configure Daily Limit (Platform Policy)</h2>
        
        <div className="space-y-4">
          <div>
            <label htmlFor="router-daily-limit" className="block mb-1 text-sm font-medium text-gray-400">Max Daily Spending (USDC)</label>
            <input 
              id="router-daily-limit"
              type="number" 
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              disabled={!isConnected}
              className="w-full max-w-md p-2 text-white bg-black border border-gray-700 rounded focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">This value is saved on platform and used by gateway policy checks for daily spending control.</p>
          </div>

          <button
            onClick={handleSaveDailyLimit}
            disabled={!isConnected || isSavingDailyLimit}
            className="px-6 py-2 font-bold text-white transition-colors bg-blue-600 rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSavingDailyLimit ? "Saving..." : "Save Daily Limit"}
          </button>
          {dailyLimitUpdatedAt ? (
            <p className="text-xs text-gray-500">
              Last updated: {new Date(dailyLimitUpdatedAt * 1000).toLocaleString()}
            </p>
          ) : null}
        </div>
      </div>
      </div>
    </div>
  );
}
