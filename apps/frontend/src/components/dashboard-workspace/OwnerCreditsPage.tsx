"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CircleAlert } from "lucide-react";
import { useAccount } from "wagmi";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useAuth } from "@/components/WalletAuthGuard";
import { useOwnerData } from "@/hooks/useOwnerData";
import { listAgentCredentials, type AgentCredentialRecord } from "@/utils/agentCredentialApi";
import { clearAuthSession, WALLET_SESSION_MISSING_MESSAGE } from "@/utils/authSession";

function formatUsd(value: number): string {
  return `$${Math.max(0, value).toFixed(2)}`;
}

function getBillingCycleWindow(now = new Date()) {
  const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const msPerDay = 1000 * 60 * 60 * 24;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysRemaining = Math.max(0, Math.round((cycleEnd.getTime() - todayStart.getTime()) / msPerDay));

  return {
    cycleLabel: `${cycleStart.toLocaleString(undefined, { month: "short" })} ${cycleStart.getDate()} - ${cycleEnd.toLocaleString(undefined, {
      month: "short",
    })} ${cycleEnd.getDate()}, ${cycleEnd.getFullYear()}`,
    daysRemaining,
  };
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, value)).toFixed(1).replace(/\\.0$/, "")}%`;
}

export default function OwnerCreditsPage() {
  const { t } = useLanguage();
  const { address: userAddress, isConnected } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const { stats, logs } = useOwnerData();
  const [credentials, setCredentials] = useState<AgentCredentialRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchCredits = useCallback(async () => {
    if (!isConnected || !userAddress || !isSessionAuthenticated) {
      setCredentials([]);
      return;
    }

    try {
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
    }
  }, [isConnected, isSessionAuthenticated, userAddress]);

  useEffect(() => {
    void fetchCredits();
  }, [fetchCredits]);

  const creditSummary = useMemo(() => {
    const allocated = credentials.reduce((sum, agent) => sum + Math.max(0, agent.creditLimit ?? 0), 0);
    const treasuryAvailable = Number.parseFloat(stats.ownerBalance) || 0;
    const remainingBalance = treasuryAvailable + allocated;
    const currentSpend = logs.reduce((sum, row) => sum + Math.max(0, row.total_charge ?? row.unit_price ?? 0), 0);
    const billingCycleCap = Math.max(remainingBalance, currentSpend, 0);
    const spendRatio = billingCycleCap > 0 ? (currentSpend / billingCycleCap) * 100 : 0;

    return {
      remainingBalance,
      currentSpend,
      billingCycleCap,
      spendRatio,
    };
  }, [credentials, logs, stats.ownerBalance]);

  const billingCycle = useMemo(() => getBillingCycleWindow(), []);

  return (
    <div className="mx-auto w-full max-w-[1040px] px-8 py-10">
      <div className="border-b border-white/8 pb-9">
        <h1 className="text-[43px] font-semibold tracking-[-0.04em] text-white">{t("creditsPage.title")}</h1>
        <p className="mt-3 text-[18px] text-[#8b98b4]">{t("creditsPage.description")}</p>
      </div>

      <div className="mt-12 space-y-7">
        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="rounded-[18px] border border-white/10 bg-[#141414] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="flex flex-col gap-5 rounded-[12px] border border-white/10 bg-[#1d1d1d] px-6 py-7 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[14px] text-[#8b98b4]">{t("creditsPage.remainingBalanceLabel")}</p>
              <div className="mt-2 flex items-center gap-2">
                <p className="text-[44px] font-semibold leading-none tracking-[-0.04em] text-white">
                  {formatUsd(creditSummary.remainingBalance)}
                </p>
                <CircleAlert className="mt-1 h-4 w-4 text-[#8b98b4]" />
              </div>
            </div>
            <Link
              href="/dashboard/billing"
              className="inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-[15px] font-medium text-black transition hover:bg-white/90"
            >
              {t("creditsPage.purchaseCredits")}
            </Link>
          </div>
        </section>

        <section className="rounded-[18px] border border-white/10 bg-[#1f1f1f] px-6 py-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start gap-3">
              <CalendarDays className="mt-1 h-4 w-4 text-[#8b98b4]" />
              <div>
                <p className="text-[14px] text-[#8b98b4]">{t("creditsPage.currentBillingCycle")}</p>
                <p className="mt-1 text-[18px] font-semibold text-white">{billingCycle.cycleLabel}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[14px] text-[#8b98b4]">{t("creditsPage.daysRemaining")}</p>
              <p className="mt-1 text-[18px] font-semibold text-white">{billingCycle.daysRemaining}</p>
            </div>
          </div>
        </section>

        <section className="rounded-[18px] border border-white/10 bg-[#1f1f1f] px-6 py-7 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="max-w-[640px]">
              <h2 className="text-[18px] font-semibold text-white">{t("creditsPage.manageSpendCapTitle")}</h2>
              <p className="mt-3 text-[15px] leading-7 text-[#8b98b4]">{t("creditsPage.manageSpendCapDescription")}</p>
            </div>
            <button
              type="button"
              className="inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-[15px] font-medium text-black transition hover:bg-white/90"
            >
              {t("creditsPage.manageSpendCap")}
            </button>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-8 md:grid-cols-2">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#8b98b4]">{t("creditsPage.currentSpend")}</p>
              <p className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-white">{formatUsd(creditSummary.currentSpend)}</p>
            </div>
            <div className="text-left md:text-right">
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#8b98b4]">{t("creditsPage.billingCycleCap")}</p>
              <p className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-white">{formatUsd(creditSummary.billingCycleCap)}</p>
            </div>
          </div>

          <div className="mt-7 h-2 rounded-full bg-white/10">
            <div
              className="h-2 rounded-full bg-[#4f8df7] transition-[width]"
              style={{ width: `${Math.max(1.5, creditSummary.spendRatio)}%` }}
            />
          </div>
          <p className="mt-3 text-[14px] text-[#8b98b4]">{t("creditsPage.usedPercent", { percent: formatPercent(creditSummary.spendRatio) })}</p>
        </section>

        <section className="flex flex-col gap-6 rounded-[18px] border border-white/10 bg-[#1f1f1f] px-6 py-8 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] md:flex-row md:items-start md:justify-between">
          <div className="max-w-[600px]">
            <h2 className="text-[18px] font-semibold text-white">{t("creditsPage.freeCreditsVoucherTitle")}</h2>
            <p className="mt-3 text-[15px] leading-7 text-[#8b98b4]">{t("creditsPage.freeCreditsVoucherDescription")}</p>
          </div>
          <button
            type="button"
            className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-white px-6 text-[15px] font-medium text-black transition hover:bg-white/90"
          >
            {t("creditsPage.redeemVoucher")}
          </button>
        </section>
      </div>
    </div>
  );
}
