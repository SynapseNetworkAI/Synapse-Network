"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Server, ArrowRight, Shield, Gauge, Link2, Search } from "lucide-react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useDashboardData } from "@/hooks/useDashboardData";

type NodeStatus = "all" | "online" | "offline";

export default function ProviderNodesPage() {
  const { services } = useDashboardData();
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [queryInput, setQueryInput] = useState("");
  const [statusInput, setStatusInput] = useState<NodeStatus>("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<NodeStatus>("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 8;

  const applySearch = () => {
    setQuery(queryInput);
    setStatus(statusInput);
    setPage(1);
  };

  const handleSearch = () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    applySearch();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter((svc) => {
      const byServiceId = (svc.serviceId || "").toLowerCase().includes(q);
      const byName = (svc.name || "").toLowerCase().includes(q);
      const matchesText = !q || byServiceId || byName;
      const matchesStatus =
        status === "all" ||
        (status === "online" && svc.isActive) ||
        (status === "offline" && !svc.isActive);
      return matchesText && matchesStatus;
    });
  }, [query, services, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  return (
    <div className="p-6 md:p-10 mx-auto max-w-7xl text-white bg-[#000000] min-h-screen space-y-6">
      <div className="border-b border-[#222222] pb-5">
        <h1 className="text-3xl md:text-4xl font-[800] tracking-tight text-white flex items-center gap-3">
          <Server className="w-8 h-8 text-[#22c55e]" />
          API Services
        </h1>
        <p className="mt-2 text-sm text-[#86868b]">
          Service endpoints, status, pricing, and readiness for marketplace routing.
        </p>
      </div>

      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-3 flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#222222] bg-[#050505] w-full lg:w-[360px]">
          <Search className="w-4 h-4 text-[#86868b]" />
          <input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSearch();
              }
            }}
            placeholder="Search Service ID or name"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-[#86868b]"
          />
        </label>
        <div className="flex items-center gap-2">
          <select
            value={statusInput}
            onChange={(e) => setStatusInput(e.target.value as NodeStatus)}
            className="px-3 py-2 rounded-lg border border-[#222222] bg-[#050505] text-sm text-white outline-none min-w-[130px]"
          >
            <option value="all">All Status</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </select>
          <button
            onClick={handleSearch}
            className="px-4 py-2 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e] text-sm font-semibold hover:bg-[#22c55e] hover:text-black transition-colors"
          >
            Search
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[1.5rem] border border-[#222222] bg-[#0a0a0a]">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
              <th className="py-5 px-6">Service</th>
              <th className="py-5 px-6">Service ID</th>
              <th className="py-5 px-6">Pricing</th>
              <th className="py-5 px-6 text-center">State</th>
              <th className="py-5 px-6 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-14 text-center text-sm text-[#86868b]">
                  No API services match the current filters.
                </td>
              </tr>
            )}
            {pageRows.map((svc) => (
              <tr key={svc.id} className="hover:bg-[#111111] transition-colors">
                <td className="py-5 px-6">
                  <div className="font-semibold text-white">{svc.name || "Unnamed Service"}</div>
                  <div className="text-xs text-[#86868b] mt-1 flex items-center gap-1">
                    <Link2 className="w-3.5 h-3.5" />
                    {svc.endpoint || "-"}
                  </div>
                </td>
                <td className="py-5 px-6 text-sm font-mono text-[#e5e5ea]">{svc.serviceId}</td>
                <td className="py-5 px-6 text-sm text-[#e5e5ea] font-mono">{svc.pricing} USDC / CALL</td>
                <td className="py-5 px-6 text-center">
                  {svc.isActive ? (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold text-[#22c55e] border border-[#22c55e]/30 bg-[#22c55e]/10">
                      <Gauge className="w-3 h-3 mr-1" />
                      Online
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold text-[#86868b] border border-[#333333] bg-[#111111]">
                      Offline
                    </span>
                  )}
                </td>
                <td className="py-5 px-6 text-right">
                  <Link
                    href="/provider/services"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-[#333333] hover:border-[#ffffff] text-white hover:bg-white hover:text-black transition-all"
                  >
                    Manage <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </td>
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
        <Shield className="w-4 h-4 text-[#22c55e]" />
        Publish flow requires at least one Access Key to protect provider endpoints with gateway signature validation.
      </div>
    </div>
  );
}
