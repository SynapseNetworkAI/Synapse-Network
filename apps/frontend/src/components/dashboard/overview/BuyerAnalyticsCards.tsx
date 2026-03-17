import { Activity, ActivitySquare, ArrowUpRight, Wallet } from "lucide-react";
import { BuyerStats } from "@/hooks/useBuyerData";

type BuyerAnalyticsCardsProps = {
  stats: BuyerStats;
};

export default function BuyerAnalyticsCards({ stats }: BuyerAnalyticsCardsProps) {
  return (
    <>
      <div className="mt-12 mb-4">
        <h2 className="pl-3 text-xl font-bold text-white border-l-4 border-blue-500">Tier 2: Buyer Analytics</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-4">
        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Available Balance</h3>
            <Wallet className="w-5 h-5 text-blue-500" />
          </div>
          <div className="mb-1 text-3xl font-bold text-white">
            <span className="text-blue-500">$</span>
            {stats.buyerBalance}
          </div>
          <p className="text-xs text-gray-500">Spendable USDC in Vault</p>
        </div>
        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Today's Spend</h3>
            <ArrowUpRight className="w-5 h-5 text-red-400" />
          </div>
          <div className="mb-1 text-2xl font-bold text-red-400">-${stats.todaySpend}</div>
          <p className="text-xs text-gray-500">USDC consumed today</p>
        </div>
        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Total Invocations</h3>
            <Activity className="w-5 h-5 text-green-400" />
          </div>
          <div className="mb-1 text-2xl font-bold text-green-400">{stats.todayCalls}</div>
          <p className="text-xs text-gray-500">Successful calls today</p>
        </div>
        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Blocked Calls</h3>
            <ActivitySquare className="w-5 h-5 text-yellow-400" />
          </div>
          <div className="mb-1 text-2xl font-bold text-yellow-400">{stats.blockedCalls}</div>
          <p className="text-xs text-gray-500">Failed or insufficient funds</p>
        </div>
      </div>
    </>
  );
}
