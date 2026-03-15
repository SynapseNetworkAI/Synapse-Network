"use client";

import { useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatUnits } from "viem";
import contractConfig from "@/contract-config.json";
import { ShieldAlert, Download, DollarSign, Wallet } from "lucide-react";
import toast from "react-hot-toast";

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const VAULT_ADDRESS = (contractConfig as any).SynapseCore as `0x${string}`;

const vaultABI = [
  {
    inputs: [],
    name: "platformFeePool",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    name: "withdrawPlatformFees",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  }
];

export default function AdminGlobalDashboard() {
  const { address } = useAccount();

  // Note: hardcoding the initial hardhat owner for demo UI gating
  const isAdmin = address?.toLowerCase() === "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".toLowerCase();

  const { data: feePoolRaw, refetch: refetchFeePool } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultABI,
    functionName: "platformFeePool",
  });

  const { data: hash, writeContractAsync, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isConfirmed) {
      toast.success("Platform fees successfully claimed!");
      refetchFeePool();
    }
  }, [isConfirmed, refetchFeePool]);

  const handleClaimFees = async () => {
    if (!feePoolRaw || (feePoolRaw as bigint) === BigInt(0)) {
      toast.error("No fees to claim");
      return;
    }
    
    try {
      await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultABI,
        functionName: "withdrawPlatformFees",
        args: [feePoolRaw],
      });
    } catch (err: unknown) {
      toast.error("Failed to claim fees: " + String((err as Error)?.message || err));
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h1 className="text-2xl font-bold text-white">Access Denied</h1>
        <p className="text-gray-400 mt-2">This is the Admin Space. Your current wallet is not the platform owner.</p>
      </div>
    );
  }

  const feePoolUSDC = feePoolRaw ? formatUnits(feePoolRaw as bigint, 18) : "0.00";

  return (
    <div className="max-w-5xl p-8 mx-auto space-y-8">
      <div className="flex items-center justify-between pb-4 border-b border-red-900/50">
        <div>
          <h1 className="flex items-center text-3xl font-bold text-white">
            <ShieldAlert className="w-8 h-8 mr-3 text-red-500" />
            Admin Space: Global Dashboard
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            Monitor protocol revenue and extract accrued platform fees safely.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 border border-red-900/40 rounded-xl bg-red-900/10 shadow-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="flex items-center text-sm font-semibold tracking-wider text-red-400 uppercase">
                <DollarSign className="w-5 h-5 mr-2" />
                Protocol Fee Accrued
              </p>
              <div className="mt-4 flex items-baseline gap-2 text-white">
                <span className="text-5xl font-black">
                  {feePoolUSDC}
                </span>
                <span className="text-gray-400 text-lg">USDC</span>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                This pool collects fees automatically during Provider settlement with 0-gas overhead for the protocol.
              </p>
            </div>
          </div>
          
          <div className="mt-8 border-t border-red-900/30 pt-6">
            <button
              onClick={handleClaimFees}
              disabled={isPending || isConfirming || (feePoolRaw as bigint) === BigInt(0)}
              className="w-full flex items-center justify-center px-6 py-3 text-lg font-bold text-white transition-colors bg-red-600 hover:bg-red-500 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending || isConfirming ? (
                <span className="animate-pulse">Processing Transaction...</span>
              ) : (
                <>
                  <Download className="w-5 h-5 mr-2" />
                  Claim Platform Fees
                </>
              )}
            </button>
          </div>
        </div>
        
        <div className="p-6 border border-gray-800 rounded-xl bg-gray-900/50">
          <h2 className="flex items-center text-lg font-bold text-white mb-4">
            <Wallet className="w-5 h-5 mr-2 text-gray-400" />
            Treasury Address
          </h2>
          <div className="p-4 bg-black rounded-lg border border-gray-800 font-mono text-sm text-gray-300 break-all">
            {address}
          </div>
          <p className="mt-4 text-xs text-gray-500">
            Only this specific address can execute administrative operations explicitly. The Vault contract cryptographically isolates user principal from platform operational profits.
          </p>
        </div>
      </div>
    </div>
  );
}