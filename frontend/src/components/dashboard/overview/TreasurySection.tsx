import Link from "next/link";
import { ActivitySquare, Wallet } from "lucide-react";

type TreasurySectionProps = {
  masterBalance: string;
  userAddress?: string;
};

export default function TreasurySection({ masterBalance, userAddress }: TreasurySectionProps) {
  return (
    <>
      <div className="mb-4">
        <h2 className="pl-3 text-xl font-bold text-white border-l-4 border-yellow-500">Tier 1: Provider Treasury (Master Wallet)</h2>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-2">
        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-400">Master USDC Balance</h3>
            <Wallet className="w-5 h-5 text-yellow-500" />
          </div>
          <div className="mb-2 text-4xl font-bold text-white">
            <span className="text-yellow-500">$</span>
            {masterBalance}
          </div>
          <p className="font-mono text-xs text-gray-500 truncate">{userAddress || "Not Connected"}</p>
        </div>

        <div className="relative flex flex-col justify-center p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <h3 className="mb-2 text-sm font-medium text-gray-400">Fund Router & Auto-Top-Up</h3>
          <p className="mb-4 text-xs text-gray-500">Manage smart contract daily limits and relayer settings for your service wallets.</p>
          <Link href="/dashboard/router" className="flex items-center justify-center w-full px-4 py-3 text-sm font-bold text-black transition-colors bg-yellow-500 rounded-lg hover:bg-yellow-600">
            <ActivitySquare className="w-5 h-5 mr-2" />
            Configure Smart Contract Limits
          </Link>
        </div>
      </div>
    </>
  );
}
