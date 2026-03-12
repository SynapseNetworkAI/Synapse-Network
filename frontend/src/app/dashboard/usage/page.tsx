"use client";

import { useUsageData } from "@/hooks/useUsageData";
import { formatEther } from "viem";

export default function UsageAnalyticsPage() {
  const { loading, stats, refetch } = useUsageData();

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-xl text-default-500 animate-pulse">Loading Analytics...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-default-900">Usage & Analytics</h1>
        <button
          onClick={refetch}
          className="px-4 py-2 bg-primary/10 text-primary rounded-xl hover:bg-primary/20 transition-colors text-sm font-medium"
        >
          Refresh Data
        </button>
      </div>

      {/* High-level KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-content1 rounded-2xl p-6 border border-default-200 shadow-sm">
          <p className="text-sm font-medium text-default-500 mb-1">Total Buyer Setup Calls</p>
          <p className="text-3xl font-bold text-default-900">{stats.totalBuyerCalls}</p>
        </div>
        <div className="bg-content1 rounded-2xl p-6 border border-default-200 shadow-sm">
          <p className="text-sm font-medium text-default-500 mb-1">Total Spent</p>
          <p className="text-3xl font-bold text-warning-500">
            {parseFloat(formatEther(BigInt(Math.floor(stats.totalBuyerSpent)))).toFixed(6)} <span className="text-lg">USDC</span>
          </p>
        </div>
        <div className="bg-content1 rounded-2xl p-6 border border-default-200 shadow-sm">
          <p className="text-sm font-medium text-default-500 mb-1">Total Seller Calls Served</p>
          <p className="text-3xl font-bold text-default-900">{stats.totalSellerCalls}</p>
        </div>
        <div className="bg-content1 rounded-2xl p-6 border border-default-200 shadow-sm">
          <p className="text-sm font-medium text-default-500 mb-1">Total Earned</p>
          <p className="text-3xl font-bold text-success-500">
            {parseFloat(formatEther(BigInt(Math.floor(stats.totalSellerEarned)))).toFixed(6)} <span className="text-lg">USDC</span>
          </p>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="bg-content1 rounded-2xl border border-default-200 overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-default-200 bg-default-50">
          <h2 className="text-lg font-semibold text-default-900">Aggregated Usage by Service</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-default-100/50 text-default-600 text-sm">
                <th className="py-4 px-6 font-medium">Service ID</th>
                <th className="py-4 px-6 font-medium">Total Calls</th>
                <th className="py-4 px-6 font-medium text-right">Spent (Buyer)</th>
                <th className="py-4 px-6 font-medium text-right">Earned (Seller)</th>
                <th className="py-4 px-6 font-medium text-right">Platform Fee Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default-200 text-sm">
              {stats.aggregatedList.length > 0 ? (
                stats.aggregatedList.map((st) => (
                  <tr key={st.serviceId} className="hover:bg-default-50/50 transition-colors">
                    <td className="py-4 px-6 font-mono text-default-900">{st.serviceId}</td>
                    <td className="py-4 px-6 font-medium">{st.totalCalls}</td>
                    <td className="py-4 px-6 font-mono text-warning-600 text-right">
                      {parseFloat(formatEther(BigInt(Math.floor(st.totalSpent)))).toFixed(6)}
                    </td>
                    <td className="py-4 px-6 font-mono text-success-600 text-right">
                      {parseFloat(formatEther(BigInt(Math.floor(st.totalEarned)))).toFixed(6)}
                    </td>
                    <td className="py-4 px-6 font-mono text-default-500 text-right">
                      {parseFloat(formatEther(BigInt(Math.floor(st.platformFee)))).toFixed(6)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-default-500">
                    No usage metrics available yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
