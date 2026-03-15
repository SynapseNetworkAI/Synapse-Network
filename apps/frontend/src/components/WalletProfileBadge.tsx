"use client";

import { useAccount, useDisconnect, useReadContract, useWatchContractEvent } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Coins, LogOut } from "lucide-react";
import toast from "react-hot-toast";
import { useCallback } from "react";
import { clearAuthSession, buildAuthedHeaders } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";
import contractConfig from "@/contract-config.json";
import { parseAbi } from "viem";

export default function WalletProfileBadge() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  const { data: walletUsdcBalanceRaw, refetch } = useReadContract({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address }
  });

  const masterBalance = walletUsdcBalanceRaw === undefined
    ? "0.00"
    : (Number(walletUsdcBalanceRaw) / 1e18).toFixed(2);

  useWatchContractEvent({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]),
    eventName: "Transfer",
    onLogs(logs) {
      if (logs.some(log => log.args.from === address || log.args.to === address)) {
        refetch();
      }
    },
  });

  const handleLogout = useCallback(async () => {
    if (address) {
      try {
        const response = await fetch(`${getGatewayBaseUrl()}/api/v1/auth/logout`, {
          method: "POST",
          headers: {
            ...buildAuthedHeaders(address, false),
          },
        });
        if (!response.ok && response.status !== 404) {
          console.warn("Backend logout warning:", response.status);
        }
      } catch (error) {
        console.warn("Backend logout warning:", error);
      }
    }
    clearAuthSession();
    disconnect();
    toast.success("Wallet disconnected");
  }, [address, disconnect]);

  if (!isConnected) {
    return <ConnectButton />;
  }

  return (
    <div className="flex gap-4">
      <div className="flex items-center space-x-4 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2">
        <div className="flex items-center text-sm font-medium text-white">
          <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse" />
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </div>
        <div className="h-4 w-px bg-gray-700" />
        <div className="flex items-center text-sm font-bold text-green-400">
          <Coins className="w-4 h-4 mr-1.5" />
          {masterBalance} USDC
        </div>
      </div>
      <button
        onClick={handleLogout}
        className="flex items-center px-4 py-2 text-sm font-bold text-red-400 transition-colors bg-gray-900 border border-red-900/50 rounded-lg hover:bg-red-950/30"
        title="Disconnect Wallet"
      >
        <LogOut className="w-4 h-4 mr-2" />
        Disconnect
      </button>
    </div>
  );
}
