"use client";

import { useMemo, useState } from "react";
import { Database } from "lucide-react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useDashboardData } from "@/hooks/useDashboardData";

function formatTimestamp(seconds?: number | string, locale?: string): string {
  if (!seconds) return "-";
  const numSeconds = typeof seconds === "string" ? Number.parseInt(seconds, 10) : seconds;
  if (Number.isNaN(numSeconds)) return "-";
  return new Date(numSeconds * 1000).toLocaleString(locale);
}

export default function ProviderInvocationRecordsPage() {
  const { providerStats, paidEvents } = useDashboardData();
  const { t, lang } = useLanguage();
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const [requestInput, setRequestInput] = useState("");
  const [serviceInput, setServiceInput] = useState("");
  const [requestQuery, setRequestQuery] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const [page, setPage] = useState(1);
  const locale = lang === "zh" ? "zh-CN" : "en-US";

  const PAGE_SIZE = 10;

  const applySearch = () => {
    setRequestQuery(requestInput);
    setServiceQuery(serviceInput);
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

  return (
    <div className="p-6 md:p-10 mx-auto max-w-7xl text-white bg-[#000000] min-h-screen space-y-6">
      <div className="border-b border-[#222222] pb-5">
        <div className="flex items-center gap-3">
          <Link
            href="/provider/withdraw"
            className="text-sm text-[#86868b] hover:text-white transition-colors"
          >
            ← {t("providerSettlements.backToWithdraw")}
          </Link>
        </div>
        <h1 className="mt-3 text-3xl md:text-4xl font-[800] tracking-tight text-white flex items-center gap-3">
          <Database className="w-8 h-8 text-[#22c55e]" />
          {t("providerSettlements.invocationRecordsTitle")}
        </h1>
        <p className="mt-2 text-sm text-[#86868b]">
          {t("providerSettlements.invocationRecordsDescription")}
        </p>
      </div>

      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-3 flex flex-col lg:flex-row lg:items-center gap-2">
        <input
          value={requestInput}
          onChange={(e) => setRequestInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSearch();
            }
          }}
          placeholder={t("providerSettlements.searchRequestPlaceholder")}
          className="px-3 py-2 rounded-lg border border-[#222222] bg-[#050505] text-sm text-white outline-none placeholder:text-[#86868b] w-full lg:w-[320px]"
        />
        <input
          value={serviceInput}
          onChange={(e) => setServiceInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSearch();
            }
          }}
          placeholder={t("providerSettlements.searchServicePlaceholder")}
          className="px-3 py-2 rounded-lg border border-[#222222] bg-[#050505] text-sm text-white outline-none placeholder:text-[#86868b] w-full lg:w-[320px]"
        />
        <button
          onClick={handleSearch}
          className="px-4 py-2 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e] text-sm font-semibold hover:bg-[#22c55e] hover:text-black transition-colors lg:ml-auto"
        >
          {t("providerSettlements.searchButton")}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">{t("providerSettlements.summaryNetEarned")}</div>
          <div className="text-2xl font-mono font-bold text-white">{providerStats.netEarned.toFixed(4)} USDC</div>
        </div>
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">{t("providerSettlements.summaryGrossEarnings")}</div>
          <div className="text-2xl font-mono font-bold text-white">{providerStats.totalEarned.toFixed(4)} USDC</div>
        </div>
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">{t("providerSettlements.summaryProtocolFee")}</div>
          <div className="text-2xl font-mono font-bold text-[#ff9f0a]">{providerStats.totalFees.toFixed(4)} USDC</div>
        </div>
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">{t("providerSettlements.summaryRoutingTax")}</div>
          <div className="text-2xl font-mono font-bold text-[#22c55e]">{providerStats.totalRoutingTax.toFixed(4)} USDC</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[1.5rem] border border-[#222222] bg-[#0a0a0a]">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
              <th className="py-5 px-6">{t("providerSettlements.eventsTableRequestId")}</th>
              <th className="py-5 px-6">{t("providerSettlements.eventsTableService")}</th>
              <th className="py-5 px-6 text-right">{t("providerSettlements.eventsTableGross")}</th>
              <th className="py-5 px-6 text-right">{t("providerSettlements.eventsTableProtocolFee")}</th>
              <th className="py-5 px-6 text-right">{t("providerSettlements.eventsTableRoutingTax")}</th>
              <th className="py-5 px-6 text-right">{t("providerSettlements.eventsTableNet")}</th>
              <th className="py-5 px-6 text-right">{t("providerSettlements.eventsTableCallTime")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-14 text-center text-sm text-[#86868b]">
                  {t("providerSettlements.eventsTableEmpty")}
                </td>
              </tr>
            )}
            {pageRows.map((event) => (
              <tr key={event.txHash + String(event.blockNumber)} className="hover:bg-[#111111] transition-colors">
                <td className="py-4 px-6 text-xs font-mono text-[#86868b]">{event.txHash}</td>
                <td className="py-4 px-6 text-sm font-semibold text-white">{event.serviceId || t("providerSettlements.unknownService")}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-white">{event.amount.toFixed(4)}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-[#ff9f0a]">{event.fee.toFixed(4)}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-[#22c55e]">{event.routingTax.toFixed(4)}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-white">{(event.amount - event.fee).toFixed(4)}</td>
                <td className="py-4 px-6 text-xs text-right text-[#86868b]">{formatTimestamp(event.timestamp, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-[#86868b]">
        <div>
          {t("providerSettlements.paginationShowing", {
            start: (safePage - 1) * PAGE_SIZE + (filtered.length ? 1 : 0),
            end: Math.min(safePage * PAGE_SIZE, filtered.length),
            total: filtered.length,
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#0a0a0a] disabled:opacity-40"
          >
            {t("providerSettlements.paginationPrev")}
          </button>
          <span className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#050505] text-white">
            {safePage} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage >= pageCount}
            className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#0a0a0a] disabled:opacity-40"
          >
            {t("providerSettlements.paginationNext")}
          </button>
        </div>
      </div>
    </div>
  );
}
