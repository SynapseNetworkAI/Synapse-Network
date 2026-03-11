"use client";

import { useAccount, useDisconnect } from "wagmi";
import { useDashboardData } from "@/hooks/useDashboardData";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Coins, LogOut } from "lucide-react";
import toast from "react-hot-toast";
import { useCallback } from "react";
import { clearAuthSession, buildAuthedHeaders } from "@/utils/authSession";

export default function WalletProfileBadge() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  // We use useDashboardData just to get the masterBalance
  const { masterBalance } = useDashboardData();

  const handleLogout = useCallback(async () => {
    if (address) {
      try {
        await fetch("http://127.0.0.1:8000/api/client/logout", {
          method: "POST",
          headers: {
            ...buildAuthedHeaders(address, false),
          },
        });
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
