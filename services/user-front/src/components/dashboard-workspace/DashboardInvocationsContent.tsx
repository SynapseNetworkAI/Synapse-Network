"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  History,
  RefreshCw,
  RotateCcw,
  Search,
  XCircle,
} from "lucide-react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useAuth } from "@/components/WalletAuthGuard";
import XSelect from "@/components/xui/XSelect";
import { listPaginatedUsageLogs, type UsageLogRecord } from "@/utils/usageApi";
import { requestV2Refund } from "@/utils/balanceApi";
import { normalizeMoneyString } from "@/utils/money";

type InvocationStatusFilter = "all" | "accepted" | "succeeded" | "failed" | "refunded";

// ── Refund Modal ─────────────────────────────────────────────────────────────
type RefundModalProps = {
  row: UsageLogRecord;
  userAddress: string;
  onClose: () => void;
  onSuccess: () => void;
};

function RefundModal({ row, userAddress, onClose, onSuccess }: RefundModalProps) {
  const charge = row.total_charge ?? row.unit_price ?? 0;
  const [amount, setAmount] = useState(String(charge > 0 ? charge : ""));
  const [reason, setReasonState] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast.error("Please enter a valid amount.");
      return;
    }
    if (amountNum < 10) {
      toast.error("Minimum refund amount is 10 USDC.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await requestV2Refund(userAddress, {
        amountUsdc: normalizeMoneyString(amountNum),
        originRequestId: row.request_id,
        reason: reason.trim() || undefined,
        refundType: "MANUAL_APPEAL",
      });
      if (result.status === "PENDING_MANUAL_REVIEW") {
        toast.success(`Refund submitted — under review (${result.riskReasonCode || "manual review"}).`);
      } else {
        toast.success(`Refund requested: $${result.amountRefunded} USDC (${result.status}).`);
      }
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refund request failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#2a2a2a] bg-[#111] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-semibold text-white">Request Refund</h3>
        <p className="mb-4 text-sm text-[#86868b]">
          Dispute charge for invocation{" "}
          <span className="font-mono text-[#c5c5c7]">{row.request_id?.slice(0, 16)}…</span>
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#86868b]">
              Amount (USDC) — min $10
            </label>
            <input
              type="number"
              min="10"
              step="0.000001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#22c55e]/50 focus:outline-none"
            />
            {charge > 0 && (
              <p className="mt-1 text-xs text-[#86868b]">
                Original charge: ${charge.toFixed(6)} USDC
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#86868b]">
              Reason (optional)
            </label>
            <textarea
              rows={3}
              maxLength={256}
              value={reason}
              onChange={(e) => setReasonState(e.target.value)}
              placeholder="Describe why you're requesting a refund…"
              className="w-full rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder:text-[#555] focus:border-[#22c55e]/50 focus:outline-none"
            />
          </div>

          <div className="rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-xs text-[#86868b]">
            ⚠ Refunds ≥ $500 or repeat requests require manual review (12–24 h).
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] py-2 text-sm text-[#9ca3af] hover:bg-[#151515] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 rounded-xl bg-[#22c55e] py-2 text-sm font-semibold text-black hover:bg-[#16a34a] disabled:opacity-40"
            >
              {submitting ? "Submitting…" : "Submit Refund"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

function formatCost(value?: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${Number(value).toFixed(6)}`;
}

function formatRelativeTime(
  timestamp: number | undefined,
  t: (key: string, vars?: Record<string, string | number>, fallbackText?: string) => string,
): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "-";
  }

  const deltaSec = Math.max(0, Math.floor(Date.now() / 1000) - Math.floor(timestamp));
  if (deltaSec < 60) {
    return t("invocationsPage.relativeSecondsAgo", { count: deltaSec });
  }
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) {
    return t("invocationsPage.relativeMinutesAgo", { count: deltaMin });
  }
  const deltaHour = Math.floor(deltaMin / 60);
  if (deltaHour < 24) {
    return t("invocationsPage.relativeHoursAgo", { count: deltaHour });
  }
  const deltaDay = Math.floor(deltaHour / 24);
  return t("invocationsPage.relativeDaysAgo", { count: deltaDay });
}

function formatTimestamp(timestamp: number | undefined, locale: string): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "-";
  }
  return new Date(timestamp * 1000).toLocaleString(locale);
}

function formatLatency(latencyMs?: number): string {
  if (!Number.isFinite(latencyMs)) {
    return "-";
  }
  const value = Number(latencyMs);
  if (value < 1000) {
    return `${value}ms`;
  }
  return `${(value / 1000).toFixed(2)}s`;
}

function resolveCounterparty(row: UsageLogRecord, currentWallet?: string): string {
  const current = String(currentWallet || "").trim().toLowerCase();
  const owner = String(row.ownerAddress || "").trim().toLowerCase();
  const provider = String(row.providerAddress || "").trim().toLowerCase();
  if (current && owner === current) {
    return row.providerAddress || "-";
  }
  if (current && provider === current) {
    return row.ownerAddress || "-";
  }
  return row.providerAddress || row.ownerAddress || "-";
}

function StatusBadge({
  status,
  t,
}: Readonly<{
  status: UsageLogRecord["status"];
  t: (key: string, vars?: Record<string, string | number>, fallbackText?: string) => string;
}>) {
  const normalized = String(status || "").toLowerCase();
  const statusLabelMap: Record<string, string> = {
    accepted: t("invocationsPage.statusAccepted"),
    succeeded: t("invocationsPage.statusSucceeded"),
    refunded: t("invocationsPage.statusRefunded"),
    failed: t("invocationsPage.statusFailed"),
  };

  if (normalized === "failed") {
    return (
      <div className="flex items-center gap-1.5 text-red-400">
        <XCircle className="h-3.5 w-3.5" />
        <span className="text-[11px] font-bold uppercase tracking-wider">{t("invocationsPage.statusFailed")}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-emerald-400">
      <CheckCircle2 className="h-3.5 w-3.5" />
      <span className="text-[11px] font-bold uppercase tracking-wider">{statusLabelMap[normalized] || t("invocationsPage.statusSucceeded")}</span>
    </div>
  );
}

export default function DashboardInvocationsContent() {
  const { t, lang } = useLanguage();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { isSessionAuthenticated } = useAuth();
  const [rows, setRows] = useState<UsageLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [statusInput, setStatusInput] = useState<InvocationStatusFilter>("all");
  const [status, setStatus] = useState<InvocationStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [refundRow, setRefundRow] = useState<UsageLogRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!address || !isSessionAuthenticated) {
        setRows([]);
        setTotal(0);
        setHasMore(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const payload = await listPaginatedUsageLogs(address, {
          page,
          pageSize: PAGE_SIZE,
          status,
          query,
        });
        if (!cancelled) {
          setRows(payload.rows);
          setTotal(payload.total);
          setHasMore(payload.hasMore);
        }
      } catch (err) {
        if (!cancelled) {
          setRows([]);
          setTotal(0);
          setHasMore(false);
          toast.error(err instanceof Error ? err.message : t("invocationsPage.loadFailed"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [address, isSessionAuthenticated, page, query, status, t, refreshKey]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  const applyFilters = () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    setQuery(queryInput.trim());
    setStatus(statusInput);
    setPage(1);
  };

  const summary = useMemo(() => {
    const succeeded = rows.filter((row) => row.status === "succeeded" || row.status === "accepted").length;
    const failed = rows.filter((row) => row.status === "failed").length;
    return { succeeded, failed };
  }, [rows]);

  let tableBody: React.ReactNode;
  if (loading) {
    tableBody = (
      <tr>
        <td colSpan={10} className="px-6 py-12 text-center text-[#86868b]">
          <div className="inline-flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-[#22c55e]" />
            {t("invocationsPage.loading")}
          </div>
        </td>
      </tr>
    );
  } else if (rows.length === 0) {
    tableBody = (
      <tr>
        <td colSpan={10} className="px-6 py-12 text-center text-[#86868b]">
          {t("invocationsPage.empty")}
        </td>
      </tr>
    );
  } else {
    tableBody = (
      <>
        {rows.map((row) => (
          <tr key={row.id || `${row.request_id}-${row.created_at || 0}`} className="group transition-colors hover:bg-[#111111]">
            <td className="px-6 py-4">
              <span className="font-mono text-xs text-[#c5c5c7] transition-colors group-hover:text-[#22c55e]">
                {row.id || "-"}
              </span>
            </td>
            <td className="px-6 py-4">
              <div className="space-y-1">
                <div className="font-mono text-xs text-white">{row.request_id}</div>
                <div className="text-[11px] text-[#86868b]">{t("invocationsPage.originLabel")}: {row.origin_request_id || "-"}</div>
              </div>
            </td>
            <td className="px-6 py-4">
              <span className="text-sm font-medium text-white">{row.service_id || t("invocationsPage.unknownService")}</span>
            </td>
            <td className="px-6 py-4">
              <span className="font-mono text-xs text-[#c5c5c7]">{row.agent_id || "-"}</span>
            </td>
            <td className="px-6 py-4">
              <div className="flex items-center gap-2 text-[#c5c5c7]">
                <ArrowRightLeft className="h-3.5 w-3.5 text-[#86868b]" />
                <span className="font-mono text-xs">{resolveCounterparty(row, address)}</span>
              </div>
            </td>
            <td className="px-6 py-4">
              <span className="font-mono text-sm text-[#22c55e]">{formatCost(row.total_charge ?? row.unit_price)}</span>
            </td>
            <td className="px-6 py-4">
              <span className="font-mono text-xs text-[#c5c5c7]">{formatLatency(row.latency_ms)}</span>
            </td>
            <td className="px-6 py-4">
              <StatusBadge status={row.status} t={t} />
            </td>
            <td className="px-6 py-4">
              <div className="flex items-center gap-1.5 text-[#86868b]">
                <Clock className="h-3 w-3" />
                <div className="space-y-1">
                  <div className="font-mono text-xs">{formatRelativeTime(row.created_at, t)}</div>
                  <div className="text-[11px]">{formatTimestamp(row.created_at, lang === "zh" ? "zh-CN" : "en-US")}</div>
                </div>
              </div>
            </td>
            <td className="px-6 py-4">
              {(row.status === "succeeded" || row.status === "accepted") && row.request_id && (
                <button
                  type="button"
                  onClick={() => setRefundRow(row)}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#2f3336] px-2.5 py-1 text-xs text-[#9ca3af] transition hover:border-[#22c55e]/40 hover:text-[#22c55e]"
                >
                  <RotateCcw className="h-3 w-3" />
                  Refund
                </button>
              )}
            </td>
          </tr>
        ))}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="relative min-w-[280px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#86868b]" />
          <input
            type="text"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                applyFilters();
              }
            }}
            placeholder={t("invocationsPage.searchPlaceholder")}
            className="w-full rounded-xl border border-[#222222] bg-[#0a0a0a] py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-[#666666] focus:border-[#22c55e]/50 focus:outline-none"
          />
        </div>
        <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
          <XSelect
            value={statusInput}
            onChange={(next) => setStatusInput(next)}
            options={[
              { value: "all", label: t("invocationsPage.statusAll") },
              { value: "accepted", label: t("invocationsPage.statusAccepted") },
              { value: "succeeded", label: t("invocationsPage.statusSucceeded") },
              { value: "failed", label: t("invocationsPage.statusFailed") },
              { value: "refunded", label: t("invocationsPage.statusRefunded") },
            ]}
            triggerClassName="inline-flex min-h-[42px] items-center justify-between gap-3 rounded-xl border border-[#222222] bg-[#0a0a0a] px-3 py-2.5 text-sm text-white focus:border-[#22c55e]/50 focus:outline-none"
          />
          <button
            onClick={applyFilters}
            className="rounded-xl border border-[#22c55e]/40 bg-[#22c55e]/10 px-4 py-2.5 text-sm font-semibold text-[#22c55e] transition-colors hover:bg-[#22c55e] hover:text-black"
          >
            {t("invocationsPage.apply")}
          </button>
          <button
            onClick={() => {
              setQueryInput("");
              setStatusInput("all");
              setQuery("");
              setStatus("all");
              setPage(1);
            }}
            className="rounded-xl border border-[#222222] bg-[#0a0a0a] px-4 py-2.5 text-sm font-semibold text-[#c5c5c7] transition-colors hover:bg-[#111111]"
          >
            {t("invocationsPage.reset")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5">
          <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#86868b]">{t("invocationsPage.summaryRowsInPage")}</p>
          <p className="font-mono text-3xl font-bold text-white">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5">
          <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#86868b]">{t("invocationsPage.summarySucceededOrAccepted")}</p>
          <p className="font-mono text-3xl font-bold text-[#22c55e]">{summary.succeeded}</p>
        </div>
        <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5">
          <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#86868b]">{t("invocationsPage.summaryFailedInPage")}</p>
          <p className="font-mono text-3xl font-bold text-[#ff5f57]">{summary.failed}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#222222] bg-[#0a0a0a]">
        <table className="min-w-[980px] w-full border-collapse whitespace-nowrap text-left">
          <thead>
            <tr className="border-b border-[#222222] bg-[#050505]">
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-[#86868b]">{t("invocationsPage.tableInvocationId")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-[#86868b]">{t("invocationsPage.tableRequest")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-[#86868b]">{t("invocationsPage.tableService")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-[#86868b]">{t("invocationsPage.tableAgent")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-[#86868b]">{t("invocationsPage.tableCounterparty")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-[#86868b]">{t("invocationsPage.tableCostUsdc")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-[#86868b]">{t("invocationsPage.tableLatency")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-[#86868b]">{t("invocationsPage.tableStatus")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-[#86868b]">{t("invocationsPage.tableTimestamp")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-[#86868b]">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515] text-sm">{tableBody}</tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 text-xs text-[#86868b] md:flex-row md:items-center md:justify-between">
        <div>
          {t("invocationsPage.showingRange", {
            start: (safePage - 1) * PAGE_SIZE + (rows.length ? 1 : 0),
            end: Math.min(safePage * PAGE_SIZE, total),
            total,
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={safePage <= 1 || loading}
            className="rounded-lg border border-[#222222] bg-[#0a0a0a] px-3 py-1.5 disabled:opacity-40"
          >
            {t("invocationsPage.prev")}
          </button>
          <span className="rounded-lg border border-[#222222] bg-[#050505] px-3 py-1.5 text-white">
            {safePage} / {pageCount}
          </span>
          <button
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={!hasMore || safePage >= pageCount || loading}
            className="rounded-lg border border-[#222222] bg-[#0a0a0a] px-3 py-1.5 disabled:opacity-40"
          >
            {t("invocationsPage.next")}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-[#222222] bg-[#0a0a0a] p-4 text-xs text-[#86868b]">
        <History className="h-4 w-4 text-[#22c55e]" />
        <span>
          {t("invocationsPage.footer")}
        </span>
      </div>

      {refundRow && address && (
        <RefundModal
          row={refundRow}
          userAddress={address}
          onClose={() => setRefundRow(null)}
          onSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
