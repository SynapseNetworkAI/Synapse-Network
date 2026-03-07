"use client";

import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Wallet } from "lucide-react";

export default function WalletGuard({ children }: { children: React.ReactNode }) {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Wallet className="w-16 h-16 text-green-400 mb-6 animate-pulse" />
        <h2 className="text-2xl font-bold mb-4">Web3 Identity Required</h2>
        <p className="text-gray-400 max-w-md mb-8">
          Please connect your Web3 Cold Wallet (e.g., MetaMask) to access this dashboard and interact with your AI Agent fleet. This ensures non-custodial security of your funds.
        </p>
        <ConnectButton />
      </div>
    );
  }

  return <>{children}</>;
}
