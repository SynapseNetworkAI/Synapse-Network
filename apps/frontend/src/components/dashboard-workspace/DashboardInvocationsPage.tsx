"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  History,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import { useAuth } from "@/components/WalletAuthGuard";
import { listPaginatedUsageLogs, type UsageLogRecord } from "@/utils/usageApi";

type InvocationStatusFilter = "all" | "accepted" | "succeeded" | "failed" | "refunded";

const PAGE_SIZE = 10;

function formatCost(value?: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${Number(value).toFixed(6)}`;
}

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "-";
  }

  const deltaSec = Math.max(0, Math.floor(Date.now() / 1000) - Math.floor(timestamp));
  if (deltaSec < 60) {
    return `${deltaSec}s ago`;
  }
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) {
    return `${deltaMin}m ago`;
  }
  const deltaHour = Math.floor(deltaMin / 60);
  if (deltaHour < 24) {
    return `${deltaHour}h ago`;
  }
  const deltaDay = Math.floor(deltaHour / 24);
  return `${deltaDay}d ago`;
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "-";
  }
  return new Date(timestamp * 1000).toLocaleString();
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

function StatusBadge({ status }: Readonly<{ status: UsageLogRecord["status"] }>) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "failed") {
    return (
      <div className="flex items-center gap-1.5 text-red-400">
        <XCircle className="w-3.5 h-3.5" />
        <span className="text-[11px] font-bold uppercase tracking-wider">Failed</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-emerald-400">
      <CheckCircle2 className="w-3.5 h-3.5" />
      <span className="text-[11px] font-bold uppercase tracking-wider">{normalized || "succeeded"}</span>
    </div>
  );
}

export default function InvocationsPage() {
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
          toast.error(err instanceof Error ? err.message : "Failed to load invocation logs");
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
  }, [address, isSessionAuthenticated, page, query, status]);

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
        <td colSpan={8} className="px-6 py-12 text-center text-[#86868b]">
          <div className="inline-flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-[#22c55e]" />
            Loading invocation logs...
          </div>
        </td>
      </tr>
    );
  } else if (rows.length === 0) {
    tableBody = (
      <tr>
        <td colSpan={8} className="px-6 py-12 text-center text-[#86868b]">
          No invocation logs found for the current filters.
        </td>
      </tr>
    );
  } else {
    tableBody = (
      <>
        {rows.map((row) => (
          <tr key={row.id || `${row.request_id}-${row.created_at || 0}`} className="hover:bg-[#111111] transition-colors group">
            <td className="px-6 py-4">
              <span className="text-xs font-mono text-[#c5c5c7] group-hover:text-[#22c55e] transition-colors">
                {row.id || "-"}
              </span>
            </td>
            <td className="px-6 py-4">
              <div className="space-y-1">
                <div className="text-xs font-mono text-white">{row.request_id}</div>
                <div className="text-[11px] text-[#86868b]">Origin: {row.origin_request_id || "-"}</div>
              </div>
            </td>
            <td className="px-6 py-4">
              <span className="text-sm font-medium text-white">{row.service_id || "Unknown service"}</span>
            </td>
            <td className="px-6 py-4">
              <span className="text-xs font-mono text-[#c5c5c7]">{row.agent_id || "-"}</span>
            </td>
            <td className="px-6 py-4">
              <div className="flex items-center gap-2 text-[#c5c5c7]">
                <ArrowRightLeft className="w-3.5 h-3.5 text-[#86868b]" />
                <span className="text-xs font-mono">{resolveCounterparty(row, address)}</span>
              </div>
            </td>
            <td className="px-6 py-4">
              <span className="text-sm font-mono text-[#22c55e]">{formatCost(row.total_charge ?? row.unit_price)}</span>
            </td>
            <td className="px-6 py-4">
              <span className="text-xs font-mono text-[#c5c5c7]">{formatLatency(row.latency_ms)}</span>
            </td>
            <td className="px-6 py-4">
              <StatusBadge status={row.status} />
            </td>
            <td className="px-6 py-4">
              <div className="flex items-center gap-1.5 text-[#86868b]">
                <Clock className="w-3 h-3" />
                <div className="space-y-1">
                  <div className="text-xs font-mono">{formatRelativeTime(row.created_at)}</div>
                  <div className="text-[11px]">{formatTimestamp(row.created_at)}</div>
                </div>
              </div>
            </td>
          </tr>
        ))}
      </>
    );
  }

  return (
    <div className="p-6 md:p-10 mx-auto max-w-7xl text-white bg-[#000000] min-h-screen space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#222222] pb-5">
        <div>
          <h1 className="text-3xl md:text-4xl font-[800] tracking-tight text-white flex items-center gap-3">
            <History className="w-8 h-8 text-[#22c55e]" />
            Invocations
          </h1>
          <p className="mt-2 text-sm text-[#86868b]">
            Owner-scoped invocation ledger backed by the real gateway billing stream.
          </p>
        </div>
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          <div className="relative min-w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868b]" />
            <input
              type="text"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  applyFilters();
                }
              }}
              placeholder="Search invocation, request, service, or wallet"
              className="w-full pl-10 pr-4 py-2.5 bg-[#0a0a0a] border border-[#222222] rounded-xl text-sm text-white placeholder:text-[#666666] focus:outline-none focus:border-[#22c55e]/50"
            />
          </div>
          <select
            value={statusInput}
            onChange={(event) => setStatusInput(event.target.value as InvocationStatusFilter)}
            className="px-3 py-2.5 bg-[#0a0a0a] border border-[#222222] rounded-xl text-sm text-white focus:outline-none focus:border-[#22c55e]/50"
          >
            <option value="all">All status</option>
            <option value="accepted">Accepted</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>
          <button
            onClick={applyFilters}
            className="px-4 py-2.5 rounded-xl border border-[#22c55e]/40 bg-[#22c55e]/10 hover:bg-[#22c55e] hover:text-black text-sm font-semibold text-[#22c55e] transition-colors"
          >
            Apply
          </button>
          <button
            onClick={() => {
              setQueryInput("");
              setStatusInput("all");
              setQuery("");
              setStatus("all");
              setPage(1);
            }}
            className="px-4 py-2.5 rounded-xl border border-[#222222] bg-[#0a0a0a] hover:bg-[#111111] text-sm font-semibold text-[#c5c5c7] transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl p-5 border border-[#222222] bg-[#0a0a0a]">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Rows In Page</p>
          <p className="text-3xl font-mono font-bold text-white">{rows.length}</p>
        </div>
        <div className="rounded-2xl p-5 border border-[#222222] bg-[#0a0a0a]">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Succeeded Or Accepted</p>
          <p className="text-3xl font-mono font-bold text-[#22c55e]">{summary.succeeded}</p>
        </div>
        <div className="rounded-2xl p-5 border border-[#222222] bg-[#0a0a0a]">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Failed In Page</p>
          <p className="text-3xl font-mono font-bold text-[#ff5f57]">{summary.failed}</p>
        </div>
      </div>

      <div className="bg-[#0a0a0a] border border-[#222222] rounded-2xl overflow-x-auto">
        <table className="w-full text-left border-collapse whitespace-nowrap min-w-[980px]">
          <thead>
            <tr className="border-b border-[#222222] bg-[#050505]">
              <th className="px-6 py-4 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Invocation ID</th>
              <th className="px-6 py-4 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Request</th>
              <th className="px-6 py-4 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Service</th>
              <th className="px-6 py-4 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Agent</th>
              <th className="px-6 py-4 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Counterparty</th>
              <th className="px-6 py-4 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Cost (USDC)</th>
              <th className="px-6 py-4 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Latency</th>
              <th className="px-6 py-4 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Status</th>
              <th className="px-6 py-4 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515] text-sm">{tableBody}</tbody>
        </table>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-[#86868b]">
        <div>
          Showing {(safePage - 1) * PAGE_SIZE + (rows.length ? 1 : 0)}-
          {Math.min(safePage * PAGE_SIZE, total)} of {total}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={safePage <= 1 || loading}
            className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#0a0a0a] disabled:opacity-40"
          >
            Prev
          </button>
          <span className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#050505] text-white">
            {safePage} / {pageCount}
          </span>
          <button
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={!hasMore || safePage >= pageCount || loading}
            className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#0a0a0a] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[#222222] bg-[#0a0a0a] p-4 text-xs text-[#86868b] flex items-center gap-2">
        <History className="w-4 h-4 text-[#22c55e]" />
        <span>
          This page is paginated against the real owner-scoped gateway usage stream, ordered by newest billing events first.
        </span>
      </div>
    </div>
  );
}
