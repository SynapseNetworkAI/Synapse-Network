"use client";

import { Database, ReceiptText, Activity } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";

export default function ProviderSettlementsPage() {
  const { providerStats, paidEvents } = useDashboardData();

  return (
    <div className="p-6 md:p-10 mx-auto max-w-7xl text-white bg-[#000000] min-h-screen space-y-6">
      <div className="border-b border-[#222222] pb-5">
        <h1 className="text-3xl md:text-4xl font-[800] tracking-tight text-white flex items-center gap-3">
          <Database className="w-8 h-8 text-[#22c55e]" />
          Settlement Pipeline
        </h1>
        <p className="mt-2 text-sm text-[#86868b]">
          Reconciled provider payouts from gateway settlement logs (deduplicated by request ID).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Net Earnings</div>
          <div className="text-2xl font-mono font-bold text-white">{providerStats.receivable.toFixed(4)} USDC</div>
        </div>
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Gross Earnings</div>
          <div className="text-2xl font-mono font-bold text-white">{providerStats.totalEarned.toFixed(4)} USDC</div>
        </div>
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Protocol Fee</div>
          <div className="text-2xl font-mono font-bold text-[#ff9f0a]">{providerStats.totalFees.toFixed(4)} USDC</div>
        </div>
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Routing Tax</div>
          <div className="text-2xl font-mono font-bold text-[#22c55e]">{providerStats.totalRoutingTax.toFixed(4)} USDC</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[1.5rem] border border-[#222222] bg-[#0a0a0a]">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
              <th className="py-5 px-6">Request</th>
              <th className="py-5 px-6">Service</th>
              <th className="py-5 px-6 text-right">Gross</th>
              <th className="py-5 px-6 text-right">Protocol Fee</th>
              <th className="py-5 px-6 text-right">Routing Tax</th>
              <th className="py-5 px-6 text-right">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            {paidEvents.length === 0 && (
              <tr>
                <td colSpan={6} className="py-14 text-center text-sm text-[#86868b]">
                  No settlement events yet.
                </td>
              </tr>
            )}
            {paidEvents.map((event) => (
              <tr key={event.txHash + String(event.blockNumber)} className="hover:bg-[#111111] transition-colors">
                <td className="py-4 px-6 text-xs font-mono text-[#86868b]">{event.txHash}</td>
                <td className="py-4 px-6 text-sm font-semibold text-white">{event.serviceId || "unknown"}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-white">{event.amount.toFixed(4)}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-[#ff9f0a]">{event.fee.toFixed(4)}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-[#22c55e]">{event.routingTax.toFixed(4)}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-white">{(event.amount - event.fee).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-[#222222] bg-[#0a0a0a] p-4 text-xs text-[#86868b] flex items-center gap-2">
        <ReceiptText className="w-4 h-4 text-[#22c55e]" />
        <span>
          Requests are deduplicated by request ID before summary aggregation to prevent double-counting across retries.
        </span>
        <Activity className="w-4 h-4 text-[#86868b] ml-auto" />
      </div>
    </div>
  );
}
