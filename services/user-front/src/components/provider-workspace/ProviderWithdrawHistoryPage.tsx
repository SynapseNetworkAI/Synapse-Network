"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, ReceiptText, Activity, Info } from "lucide-react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import Link from "next/link";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useDashboardData } from "@/hooks/useDashboardData";
import {
  listProviderWithdrawals,
  type ProviderWithdrawRecord,
} from "@/utils/providerWithdrawApi";
import { toSafeErrorMessage } from "@/utils/providerWithdrawWallet";

const WITHDRAWAL_HISTORY_STATUS_FILTERS = [
  "ALL",
  "REQUESTED",
  "APPROVED_AUTO",
  "PENDING_MANUAL_REVIEW",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;

type WithdrawalHistoryStatusFilter = (typeof WITHDRAWAL_HISTORY_STATUS_FILTERS)[number];
type TranslateFn = (key: string, vars?: Record<string, string | number>, fallbackText?: string) => string;

function formatTimestamp(seconds?: number | string, locale?: string): string {
  if (!seconds) return "-";
  const numSeconds = typeof seconds === "string" ? Number.parseInt(seconds, 10) : seconds;
  if (Number.isNaN(numSeconds)) return "-";
  return new Date(numSeconds * 1000).toLocaleString(locale);
}

function withdrawalStatusLabel(status: ProviderWithdrawRecord["status"], t: TranslateFn): string {
  if (status === "APPROVED_AUTO") return t("providerSettlements.historyStatusApprovedAuto");
  if (status === "PENDING_MANUAL_REVIEW") return t("providerSettlements.historyStatusPendingManualReview");
  if (status === "CANCELLED") return t("providerSettlements.historyStatusCancelled");
  if (status === "REQUESTED") return t("providerSettlements.historyStatusRequested");
  if (status === "COMPLETED") return t("providerSettlements.historyStatusCompleted");
  if (status === "REJECTED") return t("providerSettlements.historyStatusRejected");
  return status;
}

function withdrawalStatusBadgeClass(status: ProviderWithdrawRecord["status"]): string {
  if (status === "COMPLETED") return "border-[#22c55e]/30 bg-[#22c55e]/10 text-[#86efac]";
  if (status === "REJECTED") return "border-[#ef4444]/30 bg-[#ef4444]/10 text-[#fca5a5]";
  if (status === "CANCELLED") return "border-[#94a3b8]/30 bg-[#94a3b8]/10 text-[#cbd5e1]";
  if (status === "APPROVED_AUTO") return "border-[#22c55e]/30 bg-[#22c55e]/10 text-[#bbf7d0]";
  return "border-[#ff9f0a]/30 bg-[#ff9f0a]/10 text-[#ffd7a1]";
}

export default function ProviderWithdrawHistoryPage() {
  const { providerStats, paidEvents } = useDashboardData();
  const { t, lang } = useLanguage();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const [requestInput, setRequestInput] = useState("");
  const [serviceInput, setServiceInput] = useState("");
  const [requestQuery, setRequestQuery] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);
  const [withdrawals, setWithdrawals] = useState<ProviderWithdrawRecord[]>([]);
  const [withdrawalStatusFilter, setWithdrawalStatusFilter] = useState<WithdrawalHistoryStatusFilter>("ALL");
  const locale = lang === "zh" ? "zh-CN" : "en-US";

  const PAGE_SIZE = 10;

  const filteredWithdrawals = useMemo(() => {
    if (withdrawalStatusFilter === "ALL") {
      return withdrawals;
    }
    return withdrawals.filter((row) => row.status === withdrawalStatusFilter);
  }, [withdrawalStatusFilter, withdrawals]);

  const withdrawalHistoryEmptyMessage = useMemo(() => {
    if (withdrawals.length === 0 || withdrawalStatusFilter === "ALL") {
      return t("providerSettlements.historyEmpty");
    }
    return t("providerSettlements.historyFilteredEmpty", {
      status: withdrawalStatusLabel(withdrawalStatusFilter, t),
    });
  }, [t, withdrawalStatusFilter, withdrawals.length]);

  const refreshWithdrawals = useCallback(async () => {
    if (!address) return;
    setLoadingWithdrawals(true);
    try {
      const rows = await listProviderWithdrawals(address);
      setWithdrawals(rows);
    } catch (error) {
      console.error("Failed to load provider withdrawals", error);
      toast.error(toSafeErrorMessage(error, t("providerSettlements.loadHistoryFailed")));
    } finally {
      setLoadingWithdrawals(false);
    }
  }, [address, t]);

  useEffect(() => {
    if (!address) {
      setWithdrawals([]);
      return;
    }
    void refreshWithdrawals();
  }, [address, refreshWithdrawals]);

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
          {t("providerSettlements.historyPageTitle")}
        </h1>
        <p className="mt-2 text-sm text-[#86868b]">
          {t("providerSettlements.historyPageDescription")}
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

      <div className="overflow-x-auto rounded-[1.5rem] border border-[#222222] bg-[#0a0a0a]">
        <div className="flex flex-col gap-3 border-b border-[#222222] bg-[#050505] px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b]">{t("providerSettlements.historyTitle")}</div>
            <div className="mt-1 text-sm text-[#c5c5c7]">
              {t("providerSettlements.historyDescription")}
              <span title={t("providerSettlements.historyDescriptionTip")}><Info className="w-3 h-3 text-[#555] inline-block ml-1 align-text-bottom cursor-help" /></span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {WITHDRAWAL_HISTORY_STATUS_FILTERS.map((status) => {
              const isActive = withdrawalStatusFilter === status;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => setWithdrawalStatusFilter(status)}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${isActive ? "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#86efac]" : "border-[#222222] bg-[#0a0a0a] text-[#86868b] hover:border-[#3a3a3a] hover:text-white"}`}
                >
                  {status === "ALL" ? t("providerSettlements.historyFilterAll") : withdrawalStatusLabel(status, t)}
                </button>
              );
            })}
          </div>
        </div>
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
              <th className="py-4 px-6">{t("providerSettlements.historyTableWithdrawalId")}</th>
              <th className="py-4 px-6 text-right">{t("providerSettlements.historyTableAmount")}</th>
              <th className="py-4 px-6">{t("providerSettlements.historyTableStatus")}</th>
              <th className="py-4 px-6">{t("providerSettlements.historyTableReason")}</th>
              <th className="py-4 px-6">{t("providerSettlements.historyTableNonce")}</th>
              <th className="py-4 px-6">{t("providerSettlements.historyTableCreated")}</th>
              <th className="py-4 px-6">{t("providerSettlements.historyTableTxHash")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            {!loadingWithdrawals && filteredWithdrawals.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-[#86868b]">{withdrawalHistoryEmptyMessage}</td>
              </tr>
            )}
            {loadingWithdrawals && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-[#86868b]">{t("providerSettlements.loadingHistory")}</td>
              </tr>
            )}
            {filteredWithdrawals.map((row) => (
              <tr key={row.id} className="hover:bg-[#111111] transition-colors">
                <td className="py-4 px-6 text-xs font-mono text-[#86868b]">{row.id}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-white">{row.amountUsdc.toFixed(6)} USDC</td>
                <td className="py-4 px-6 text-xs">
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${withdrawalStatusBadgeClass(row.status)}`}>
                    {withdrawalStatusLabel(row.status, t)}
                  </span>
                </td>
                <td className="py-4 px-6 text-xs text-[#c5c5c7]">{row.message || (row.status === "CANCELLED" ? t("providerSettlements.expiredTicketReleasedRow") : "-")}</td>
                <td className="py-4 px-6 text-xs font-mono text-[#c5c5c7]">{row.nonce}</td>
                <td className="py-4 px-6 text-xs text-[#86868b]">{formatTimestamp(row.createdAt, locale)}</td>
                <td className="py-4 px-6 text-xs font-mono text-[#86868b]">{row.txHash || "-"}</td>
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

      <div className="rounded-xl border border-[#222222] bg-[#0a0a0a] p-4 text-xs text-[#86868b] flex items-center gap-2">
        <ReceiptText className="w-4 h-4 text-[#22c55e]" />
        <span>
          {t("providerSettlements.dedupeNote")}
          <span title={t("providerSettlements.dedupeNoteTip")}><Info className="w-3 h-3 text-[#555] inline-block ml-1 align-text-bottom cursor-help" /></span>
        </span>
        <Activity className="w-4 h-4 text-[#86868b] ml-auto" />
      </div>
    </div>
  );
}
