"use client";

import { useMemo, useState } from "react";
import { Database, ReceiptText, Activity } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";

export default function ProviderSettlementsPage() {
  const { providerStats, paidEvents } = useDashboardData();
  const [requestQuery, setRequestQuery] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const filtered = useMemo(() => {
    const rq = requestQuery.trim().toLowerCase();
    const sq = serviceQuery.trim().toLowerCase();
    return paidEvents.filter((event) => {
      const matchesRequest = !rq || event.txHash.toLowerCase().includes(rq);
      const matchesService = !sq || (event.serviceId || "").toLowerCase().includes(sq);
      return matchesRequest && matchesService;
    });
  }, [paidEvents, requestQuery, serviceQuery]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const formatCallTime = (timestampSeconds: number) => {
    if (!timestampSeconds) return "-";
    return new Date(timestampSeconds * 1000).toLocaleString();
  };

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

      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          value={requestQuery}
          onChange={(e) => {
            setRequestQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search RequestId"
          className="px-3 py-2 rounded-xl border border-[#222222] bg-[#050505] text-sm text-white outline-none placeholder:text-[#86868b]"
        />
        <input
          value={serviceQuery}
          onChange={(e) => {
            setServiceQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search Service (fuzzy)"
          className="px-3 py-2 rounded-xl border border-[#222222] bg-[#050505] text-sm text-white outline-none placeholder:text-[#86868b]"
        />
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
              <th className="py-5 px-6">RequestId</th>
              <th className="py-5 px-6">Service</th>
              <th className="py-5 px-6 text-right">Gross</th>
              <th className="py-5 px-6 text-right">Protocol Fee</th>
              <th className="py-5 px-6 text-right">Routing Tax</th>
              <th className="py-5 px-6 text-right">Net</th>
              <th className="py-5 px-6 text-right">Call Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-14 text-center text-sm text-[#86868b]">
                  No settlement events yet.
                </td>
              </tr>
            )}
            {pageRows.map((event) => (
              <tr key={event.txHash + String(event.blockNumber)} className="hover:bg-[#111111] transition-colors">
                <td className="py-4 px-6 text-xs font-mono text-[#86868b]">{event.txHash}</td>
                <td className="py-4 px-6 text-sm font-semibold text-white">{event.serviceId || "unknown"}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-white">{event.amount.toFixed(4)}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-[#ff9f0a]">{event.fee.toFixed(4)}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-[#22c55e]">{event.routingTax.toFixed(4)}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-white">{(event.amount - event.fee).toFixed(4)}</td>
                <td className="py-4 px-6 text-xs text-right text-[#86868b]">{formatCallTime(event.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-[#86868b]">
        <div>
          Showing {(safePage - 1) * PAGE_SIZE + (filtered.length ? 1 : 0)}-
          {Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#0a0a0a] disabled:opacity-40"
          >
            Prev
          </button>
          <span className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#050505] text-white">
            {safePage} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage >= pageCount}
            className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#0a0a0a] disabled:opacity-40"
          >
            Next
          </button>
        </div>
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
