"use client";

import { useMemo } from "react";
import { BarChart3, LineChart, TrendingUp } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";

export default function UsageAnalyticsPage() {
  const { providerStats, paidEvents, handleRefresh, isRefreshing } = useDashboardData();

  const trendRows = useMemo(() => {
    const bucket = new Map<string, { calls: number; net: number }>();
    const days = 7;
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      bucket.set(key, { calls: 0, net: 0 });
    }

    for (const event of paidEvents) {
      if (!event.timestamp) continue;
      const key = new Date(event.timestamp * 1000).toISOString().slice(0, 10);
      if (!bucket.has(key)) continue;
      const row = bucket.get(key)!;
      row.calls += 1;
      row.net += Math.max(0, event.amount - event.fee);
    }

    return Array.from(bucket.entries()).map(([day, value]) => ({
      day,
      label: day.slice(5),
      calls: value.calls,
      net: value.net,
    }));
  }, [paidEvents]);

  const maxNet = Math.max(1, ...trendRows.map((row) => row.net));
  const maxCalls = Math.max(1, ...trendRows.map((row) => row.calls));

  const topServices = useMemo(() => {
    const map = new Map<string, { calls: number; gross: number; net: number; fee: number }>();
    for (const event of paidEvents) {
      const key = event.serviceId || "unknown";
      const current = map.get(key) || { calls: 0, gross: 0, net: 0, fee: 0 };
      current.calls += 1;
      current.gross += event.amount;
      current.net += Math.max(0, event.amount - event.fee);
      current.fee += event.fee;
      map.set(key, current);
    }
    return Array.from(map.entries())
      .map(([serviceId, value]) => ({ serviceId, ...value }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 10);
  }, [paidEvents]);


  return (
    <div className="p-6 md:p-10 mx-auto max-w-7xl text-white bg-[#000000] min-h-screen space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-[#222222] pb-5">
        <div>
          <h1 className="text-3xl md:text-4xl font-[800] tracking-tight text-white flex items-center gap-3">
            <BarChart3 className="w-8 h-8 text-[#22c55e]" />
            Seller Revenue Analytics
          </h1>
          <p className="mt-2 text-sm text-[#86868b]">
            Revenue and call trends from deduplicated settlement records.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 rounded-xl border border-[#222222] bg-[#0a0a0a] hover:bg-[#111111] text-sm font-medium text-[#e5e5ea]"
        >
          {isRefreshing ? "Refreshing..." : "Refresh Data"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl p-5 border border-[#222222] bg-[#0a0a0a]">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Net Earnings</p>
          <p className="text-3xl font-mono font-bold text-white">{providerStats.receivable.toFixed(4)} USDC</p>
        </div>
        <div className="rounded-2xl p-5 border border-[#222222] bg-[#0a0a0a]">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Gross Earnings</p>
          <p className="text-3xl font-mono font-bold text-white">{providerStats.totalEarned.toFixed(4)} USDC</p>
        </div>
        <div className="rounded-2xl p-5 border border-[#222222] bg-[#0a0a0a]">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Protocol Fee</p>
          <p className="text-3xl font-mono font-bold text-[#ff9f0a]">{providerStats.totalFees.toFixed(4)} USDC</p>
        </div>
        <div className="rounded-2xl p-5 border border-[#222222] bg-[#0a0a0a]">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Routing Tax</p>
          <p className="text-3xl font-mono font-bold text-[#22c55e]">{providerStats.totalRoutingTax.toFixed(4)} USDC</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-3 rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5">
          <div className="flex items-center gap-2 mb-4">
            <LineChart className="w-4 h-4 text-[#22c55e]" />
            <h2 className="text-sm font-semibold tracking-wide text-white">Net Earnings Trend (7D)</h2>
          </div>
          <div className="h-56 flex items-end gap-2">
            {trendRows.map((row) => {
              const h = (row.net / maxNet) * 100;
              return (
                <div key={row.day} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-2">
                  <div className="w-full rounded-t-md bg-[#22c55e]" style={{ height: `${Math.max(6, h)}%` }} />
                  <span className="text-[10px] text-[#86868b]">{row.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="xl:col-span-2 rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-[#86868b]" />
            <h2 className="text-sm font-semibold tracking-wide text-white">Call Volume Trend (7D)</h2>
          </div>
          <div className="h-56 flex items-end gap-2">
            {trendRows.map((row) => {
              const h = (row.calls / maxCalls) * 100;
              return (
                <div key={`${row.day}-calls`} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-2">
                  <div className="w-full rounded-t-md bg-[#3b82f6]" style={{ height: `${Math.max(6, h)}%` }} />
                  <span className="text-[10px] text-[#86868b]">{row.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#222222] bg-[#050505]">
          <h2 className="text-lg font-semibold text-white">Top Services by Calls</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="bg-[#050505] text-[#86868b] text-sm border-b border-[#222222]">
                <th className="py-4 px-6 font-medium">Service ID</th>
                <th className="py-4 px-6 font-medium">Total Calls</th>
                <th className="py-4 px-6 font-medium text-right">Gross</th>
                <th className="py-4 px-6 font-medium text-right">Protocol Fee</th>
                <th className="py-4 px-6 font-medium text-right">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#151515] text-sm">
              {topServices.length > 0 ? (
                topServices.map((row) => (
                  <tr key={row.serviceId} className="hover:bg-[#111111] transition-colors">
                    <td className="py-4 px-6 font-mono text-white">{row.serviceId}</td>
                    <td className="py-4 px-6 font-medium text-white">{row.calls}</td>
                    <td className="py-4 px-6 font-mono text-right text-white">{row.gross.toFixed(4)}</td>
                    <td className="py-4 px-6 font-mono text-right text-[#ff9f0a]">{row.fee.toFixed(4)}</td>
                    <td className="py-4 px-6 font-mono text-right text-[#22c55e]">{row.net.toFixed(4)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#86868b]">
                    No seller revenue metrics available yet.
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
