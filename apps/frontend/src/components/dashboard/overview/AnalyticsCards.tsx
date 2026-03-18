import { Activity, ActivitySquare, ArrowUpRight, Wallet } from "lucide-react";

type AnalyticsCardsProps = {
  servicesCount: number;
  serviceWalletTotal: string;
  totalEarned: number;
  totalFees: number;
  paidCount24h: number;
};

export default function AnalyticsCards({
  servicesCount,
  serviceWalletTotal,
  totalEarned,
  totalFees,
  paidCount24h,
}: AnalyticsCardsProps) {
  return (
    <>
      <div className="mt-12 mb-4">
        <h2 className="pl-3 text-xl font-bold text-white border-l-4 border-green-500">Tier 2: Service Analytics</h2>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-4">
        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Service Wallets Total</h3>
            <Wallet className="w-5 h-5 text-green-500" />
          </div>
          <div className="mb-1 text-3xl font-bold text-white">
            <span className="text-green-500">$</span>
            {servicesCount > 0 ? serviceWalletTotal : "0.00"}
          </div>
          <p className="text-xs text-gray-500">Across {servicesCount} registered services</p>
        </div>

        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Total Earned</h3>
            <ArrowUpRight className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="mb-1 text-2xl font-bold text-emerald-400">+${totalEarned.toFixed(2)}</div>
          <p className="text-xs text-gray-500">From ServicePaid logs</p>
        </div>

        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Total Platform Fee</h3>
            <Activity className="w-5 h-5 text-red-400" />
          </div>
          <div className="mb-1 text-2xl font-bold text-red-400">-${totalFees.toFixed(2)}</div>
          <p className="text-xs text-gray-500">Protocol fee from paid logs</p>
        </div>

        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Paid Calls (24h)</h3>
            <ActivitySquare className="w-5 h-5 text-blue-400" />
          </div>
          <div className="mb-1 text-2xl font-bold text-blue-400">{paidCount24h}</div>
          <p className="text-xs text-gray-500">Provider workspace = connected wallet</p>
        </div>
      </div>
    </>
  );
}
