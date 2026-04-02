"use client";

import { Activity, ArrowRight, Bot, HelpCircle, ShieldCheck, Wallet } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "@/components/i18n/LanguageProvider";

type ActivationStatusStripProps = {
  isConnected: boolean;
  isSessionAuthenticated: boolean;
  ownerBalance: string;
  activeAgents: number;
  lastInvocationAt?: number;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  isPrimaryActionDisabled?: boolean;
};

function formatInvocationTime(timestamp: number | undefined, emptyLabel: string): string {
  if (!timestamp) {
    return emptyLabel;
  }

  return new Date(timestamp * 1000).toLocaleString();
}

function getStatusTone(isReady: boolean): string {
  return isReady
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
    : "border-white/10 bg-white/[0.03] text-gray-400";
}

type TooltipState = {
  [key: string]: boolean;
};

export default function ActivationStatusStrip({
  isConnected,
  isSessionAuthenticated,
  ownerBalance,
  activeAgents,
  lastInvocationAt,
  primaryActionLabel,
  onPrimaryAction,
  isPrimaryActionDisabled = false,
}: Readonly<ActivationStatusStripProps>) {
  const { t } = useLanguage();
  const [tooltips, setTooltips] = useState<TooltipState>({});

  const toggleTooltip = (key: string) => {
    setTooltips((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const metrics = [
    {
      title: t("agentsPage.walletMetricTitle"),
      value: isConnected ? t("agentsPage.connected") : t("agentsPage.disconnected"),
      icon: Wallet,
      tone: getStatusTone(isConnected),
      tooltip: null,
    },
    {
      title: t("agentsPage.sessionMetricTitle"),
      value: isSessionAuthenticated ? t("agentsPage.authenticated") : t("agentsPage.missing"),
      icon: ShieldCheck,
      tone: getStatusTone(isSessionAuthenticated),
      tooltip: null,
    },
    {
      title: t("agentsPage.ownerVaultBalanceMetricTitle"),
      value: `${ownerBalance} USDC`,
      icon: Wallet,
      tone: getStatusTone(Number(ownerBalance) > 0),
      tooltip: t("agentsPage.ownerVaultBalanceTooltip"),
      tooltipKey: "platform-balance",
    },
    {
      title: t("agentsPage.activeAgentsMetricTitle"),
      value: String(activeAgents),
      icon: Bot,
      tone: getStatusTone(activeAgents > 0),
      tooltip: null,
    },
    {
      title: t("agentsPage.lastInvocationMetricTitle"),
      value: formatInvocationTime(lastInvocationAt, t("agentsPage.noSuccessfulInvocationYet")),
      icon: Activity,
      tone: getStatusTone(Boolean(lastInvocationAt)),
      tooltip: null,
    },
  ] as const;

  return (
    <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(59,130,246,0.14),rgba(8,15,28,0.82))] p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)]" aria-label={t("agentsPage.activationStatusAria")}>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-blue-300/80">{t("agentsPage.activationStatusEyebrow")}</p>
          <div>
            <h2 className="text-2xl font-semibold text-white">{t("agentsPage.activationStatusTitle")}</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              {t("agentsPage.activationStatusDescription")}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onPrimaryAction}
          disabled={isPrimaryActionDisabled}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-xs font-bold uppercase tracking-[0.22em] text-slate-950 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {primaryActionLabel}
          <ArrowRight className="h-4 w-4" />
        </button>
      </header>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {metrics.map((item) => {
          const Icon = item.icon;
          const tooltipKey = 'tooltipKey' in item ? String((item as Record<string, unknown>).tooltipKey) : undefined;
          const tooltip = 'tooltip' in item ? String((item as Record<string, unknown>).tooltip) : undefined;
          const showTooltip = tooltipKey ? tooltips[tooltipKey] : false;

          return (
            <article key={item.title} className={`relative rounded-2xl border p-4 transition ${item.tone}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-current/70">{item.title}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-white">{item.value}</p>
                  </div>
                </div>
                {tooltip && tooltipKey && (
                  <button
                    type="button"
                    onClick={() => toggleTooltip(tooltipKey)}
                    className="relative flex-shrink-0 text-current/50 hover:text-current transition"
                    aria-label={t("agentsPage.activationStatusHelpAria", { title: item.title })}
                  >
                    <HelpCircle className="h-4 w-4" />
                    {showTooltip && (
                      <div className="absolute right-0 top-6 z-10 w-48 rounded-lg bg-black/90 border border-white/20 p-3 text-xs text-gray-300 shadow-lg">
                        {tooltip}
                      </div>
                    )}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
