"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Coins, RefreshCw, Wallet } from "lucide-react";
import { useAccount } from "wagmi";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useAuth } from "@/components/WalletAuthGuard";
import { useOwnerData } from "@/hooks/useOwnerData";
import { listAgentCredentials, type AgentCredentialRecord } from "@/utils/agentCredentialApi";
import { clearAuthSession, WALLET_SESSION_MISSING_MESSAGE } from "@/utils/authSession";
import { formatAgentBudget, isAgentNeedingAttention } from "@/components/dashboard/agents/agentWorkspacePresenters";

function formatUsd(value: number): string {
  return `$${Math.max(0, value).toFixed(2)}`;
}

function formatTimestamp(timestamp: number | undefined): string {
  if (!timestamp) {
    return "--";
  }
  return new Date(timestamp * 1000).toLocaleString();
}

export default function OwnerCreditsPage() {
  const { t } = useLanguage();
  const { address: userAddress, isConnected } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const { stats, logs, handleRefresh: handleOwnerRefresh } = useOwnerData();
  const [credentials, setCredentials] = useState<AgentCredentialRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCredits = useCallback(async () => {
    if (!isConnected || !userAddress || !isSessionAuthenticated) {
      setCredentials([]);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const rows = await listAgentCredentials(userAddress);
      setCredentials(rows);
    } catch (err) {
      console.error("Failed to load credits page:", err);
      const message = err instanceof Error ? err.message : "Failed to load credits page";
      if (message === WALLET_SESSION_MISSING_MESSAGE) {
        clearAuthSession();
      }
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, isSessionAuthenticated, userAddress]);

  useEffect(() => {
    void fetchCredits();
  }, [fetchCredits]);

  const handleRefresh = useCallback(async () => {
    await Promise.allSettled([fetchCredits(), handleOwnerRefresh()]);
  }, [fetchCredits, handleOwnerRefresh]);

  const creditSummary = useMemo(() => {
    const allocated = credentials.reduce((sum, agent) => sum + Math.max(0, agent.creditLimit ?? 0), 0);
    const treasuryAvailable = Number.parseFloat(stats.ownerBalance) || 0;
    const unallocated = Math.max(0, treasuryAvailable - allocated);
    const invocationSpend = logs.reduce((sum, row) => sum + Math.max(0, row.total_charge ?? row.unit_price ?? 0), 0);

    return {
      allocated,
      treasuryAvailable,
      unallocated,
      invocationSpend,
    };
  }, [credentials, logs, stats.ownerBalance]);

  const spendByAgent = useMemo(() => {
    const next = new Map<string, number>();
    for (const log of logs) {
      if (!log.agent_id) {
        continue;
      }
      const current = next.get(log.agent_id) ?? 0;
      next.set(log.agent_id, current + Math.max(0, log.total_charge ?? log.unit_price ?? 0));
    }
    return next;
  }, [logs]);

  const ledgerRows = useMemo(() => {
    const allocationRows = credentials
      .filter((agent) => (agent.creditLimit ?? 0) > 0)
      .slice(0, 6)
      .map((agent) => ({
        id: `alloc-${agent.id}`,
        time: typeof agent.updatedAt === "number" ? agent.updatedAt : Math.floor(new Date(String(agent.updatedAt ?? agent.createdAt ?? Date.now())).getTime() / 1000),
        type: "allocation",
        amount: Math.max(0, agent.creditLimit ?? 0),
        source: t("creditsPage.sourceTreasury"),
        reference: agent.id,
      }));

    const invocationRows = logs.slice(0, 8).map((log) => ({
      id: `inv-${log.request_id}`,
      time: log.created_at ?? 0,
      type: "invocation",
      amount: Math.max(0, log.total_charge ?? log.unit_price ?? 0),
      source: t("creditsPage.sourceInvocation"),
      reference: log.request_id,
    }));

    return [...allocationRows, ...invocationRows]
      .sort((left, right) => right.time - left.time)
      .slice(0, 8);
  }, [credentials, logs, t]);

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <div className="flex flex-col gap-4 border-b border-gray-800 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">{t("creditsPage.title")}</h1>
          <p className="mt-2 max-w-3xl text-gray-400">{t("creditsPage.description")}</p>
          <p className="mt-1 text-xs text-gray-500">{t("creditsPage.note")}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard/billing" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-bold text-white transition hover:bg-white/[0.08]">
            <Wallet className="h-4 w-4" />
            {t("creditsPage.openTreasury")}
          </Link>
          <Link href="/dashboard/agents" className="inline-flex items-center gap-2 rounded-lg border border-blue-400/20 bg-blue-500/10 px-4 py-2 text-xs font-bold text-blue-300 transition hover:bg-blue-500/20">
            <Coins className="h-4 w-4" />
            {t("creditsPage.openAgentsWorkspace")}
          </Link>
          <button
            type="button"
            onClick={() => {
              void handleRefresh();
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-bold text-white transition hover:bg-white/[0.08]"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            {t("creditsPage.refreshCredits")}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-3xl border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gray-500">{t("creditsPage.treasuryAvailableTitle")}</p>
          <p className="mt-3 text-3xl font-black tracking-tight text-white">{formatUsd(creditSummary.treasuryAvailable)}</p>
          <p className="mt-2 text-sm text-gray-500">{t("creditsPage.treasuryAvailableDescription")}</p>
        </article>
        <article className="rounded-3xl border border-white/8 bg-[linear-gradient(180deg,rgba(37,99,235,0.14),rgba(15,23,42,0.22))] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-blue-300/70">{t("creditsPage.allocatedCreditsTitle")}</p>
          <p className="mt-3 text-3xl font-black tracking-tight text-white">{formatUsd(creditSummary.allocated)}</p>
          <p className="mt-2 text-sm text-blue-100/70">{t("creditsPage.allocatedCreditsDescription")}</p>
        </article>
        <article className="rounded-3xl border border-white/8 bg-[linear-gradient(180deg,rgba(16,185,129,0.12),rgba(15,23,42,0.22))] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-300/80">{t("creditsPage.unallocatedCreditsTitle")}</p>
          <p className="mt-3 text-3xl font-black tracking-tight text-white">{formatUsd(creditSummary.unallocated)}</p>
          <p className="mt-2 text-sm text-emerald-100/70">{t("creditsPage.unallocatedCreditsDescription")}</p>
        </article>
        <article className="rounded-3xl border border-white/8 bg-[linear-gradient(180deg,rgba(245,158,11,0.12),rgba(15,23,42,0.22))] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-amber-300/80">{t("creditsPage.cycleSpendTitle")}</p>
          <p className="mt-3 text-3xl font-black tracking-tight text-white">{formatUsd(creditSummary.invocationSpend)}</p>
          <p className="mt-2 text-sm text-amber-100/70">{t("creditsPage.cycleSpendDescription")}</p>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-3xl border border-white/8 bg-white/[0.02] p-6">
          <header className="mb-5">
            <h2 className="text-xl font-bold text-white">{t("creditsPage.allocationTitle")}</h2>
            <p className="mt-2 text-sm text-gray-500">{t("creditsPage.allocationDescription")}</p>
          </header>
          {credentials.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-12 text-center text-sm text-gray-500">
              {t("creditsPage.noAgents")}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/8 bg-black/20">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm text-gray-300">
                  <thead className="border-b border-white/8 bg-white/[0.03] text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500">
                    <tr>
                      <th className="px-4 py-3">{t("creditsPage.agentColumn")}</th>
                      <th className="px-4 py-3">{t("creditsPage.allocatedColumn")}</th>
                      <th className="px-4 py-3">{t("creditsPage.usedColumn")}</th>
                      <th className="px-4 py-3">{t("creditsPage.remainingColumn")}</th>
                      <th className="px-4 py-3">{t("creditsPage.statusColumn")}</th>
                      <th className="px-4 py-3 text-right">{t("creditsPage.actionColumn")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {credentials.map((agent) => {
                      const allocated = Math.max(0, agent.creditLimit ?? 0);
                      const used = Math.min(allocated, spendByAgent.get(agent.id) ?? 0);
                      const remaining = Math.max(0, allocated - used);
                      const statusLabel = allocated <= 0
                        ? t("creditsPage.statusNoCredits")
                        : isAgentNeedingAttention(agent)
                          ? t("creditsPage.statusNeedsAttention")
                          : t("creditsPage.statusHealthy");
                      const statusTone = allocated <= 0
                        ? "border-slate-400/20 bg-slate-500/10 text-slate-300"
                        : isAgentNeedingAttention(agent)
                          ? "border-amber-400/20 bg-amber-500/10 text-amber-300"
                          : "border-emerald-400/20 bg-emerald-500/10 text-emerald-300";

                      return (
                        <tr key={agent.id} className="border-b border-white/6 last:border-b-0 hover:bg-white/[0.02]">
                          <td className="px-4 py-4">
                            <p className="font-semibold text-white">{agent.name || agent.id.slice(0, 12)}</p>
                            <p className="mt-1 font-mono text-xs text-gray-500">{agent.tokenPrefix || agent.id.slice(0, 12)}</p>
                          </td>
                          <td className="px-4 py-4 font-semibold text-emerald-400">{formatAgentBudget(allocated)}</td>
                          <td className="px-4 py-4">{formatUsd(used)}</td>
                          <td className="px-4 py-4">{formatUsd(remaining)}</td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] ${statusTone}`}>
                              {statusLabel}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <Link href="/dashboard/agents" className="inline-flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs font-bold text-blue-300 transition hover:bg-blue-500/20">
                              {t("creditsPage.manageAgent")}
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </article>

        <article className="rounded-3xl border border-white/8 bg-white/[0.02] p-6">
          <header className="mb-5">
            <h2 className="text-xl font-bold text-white">{t("creditsPage.ledgerTitle")}</h2>
            <p className="mt-2 text-sm text-gray-500">{t("creditsPage.ledgerDescription")}</p>
          </header>
          {ledgerRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-12 text-center text-sm text-gray-500">
              {t("creditsPage.noLedger")}
            </div>
          ) : (
            <div className="space-y-3">
              {ledgerRows.map((row) => (
                <article key={row.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-gray-500">{row.type === "allocation" ? t("creditsPage.sourceTreasury") : t("creditsPage.sourceInvocation")}</p>
                      <p className="mt-2 text-sm font-semibold text-white">{formatUsd(row.amount)}</p>
                      <p className="mt-1 text-xs text-gray-500">{formatTimestamp(row.time)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-[0.24em] text-gray-500">{t("creditsPage.referenceColumn")}</p>
                      <p className="mt-2 font-mono text-xs text-slate-300">{row.reference}</p>
                      <p className="mt-1 text-xs text-gray-500">{row.source}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
