"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck, ShieldAlert, Activity, Bell, Zap, History, CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useAccount } from "wagmi";
import { useAuth } from "@/components/WalletAuthGuard";
import { buildAuthedHeaders } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";

type RelativeTime = {
  unit: "minutes" | "hours" | "days";
  count: number;
};

type AuditAlert = {
  id: string;
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
  timestamp: number;
};

type RiskOverview = {
  systemIntegrity: { level: string; anomalyCount24h: number };
  pendingReviews: { level: string; count: number };
  alerts: AuditAlert[];
};

type AuditTrailRecord = {
  id: string;
  actionKey: string;
  rawAction: string;
  amount: string;
  statusKey: string;
  time: RelativeTime;
};

type FinanceAuditLog = {
  id: string;
  timestamp: number;
  action: string;
  domain: string;
  ownerAddress: string;
  details?: Record<string, unknown>;
};

function toRelativeTime(timestamp: number): RelativeTime {
  const diffSec = Math.floor(Date.now() / 1000) - timestamp;
  if (diffSec < 3600) return { unit: "minutes", count: Math.max(1, Math.floor(diffSec / 60)) };
  if (diffSec < 86400) return { unit: "hours", count: Math.max(1, Math.floor(diffSec / 3600)) };
  return { unit: "days", count: Math.max(1, Math.floor(diffSec / 86400)) };
}

function formatAction(action: string): string {
  return action
    .replaceAll("_", " ")
    .toLowerCase()
    .replaceAll(/\b\w/g, (c) => c.toUpperCase());
}

const ACTION_I18N_MAP: Record<string, string> = {
  CONSUMER_DEPOSIT_CONFIRMED: "auditPage.actionDepositConfirmed",
  CONSUMER_DEPOSIT_CONFIRMED_REPAIRED: "auditPage.actionDepositRepaired",
  CONSUMER_WITHDRAW_INTENT_CREATED: "auditPage.actionWithdrawRequested",
  REFUND_INTENT_COMPLETED: "auditPage.actionWithdrawCompleted",
  PROVIDER_WITHDRAW_INTENT_CREATED: "auditPage.actionProviderWithdrawRequested",
  PROVIDER_WITHDRAW_REVIEW_APPROVED: "auditPage.actionProviderWithdrawApproved",
  PROVIDER_WITHDRAW_REVIEW_REJECTED: "auditPage.actionProviderWithdrawRejected",
  PROVIDER_WITHDRAW_COMPLETED: "auditPage.actionProviderWithdrawCompleted",
  PROVIDER_WITHDRAW_CANCELLED: "auditPage.actionProviderWithdrawCancelled",
};

const ACTION_STATUS_MAP: Record<string, string> = {
  CONSUMER_DEPOSIT_CONFIRMED: "auditPage.statusCompleted",
  CONSUMER_DEPOSIT_CONFIRMED_REPAIRED: "auditPage.statusCompleted",
  CONSUMER_WITHDRAW_INTENT_CREATED: "auditPage.statusPending",
  REFUND_INTENT_COMPLETED: "auditPage.statusCompleted",
  PROVIDER_WITHDRAW_INTENT_CREATED: "auditPage.statusPending",
  PROVIDER_WITHDRAW_REVIEW_APPROVED: "auditPage.statusApproved",
  PROVIDER_WITHDRAW_REVIEW_REJECTED: "auditPage.statusRejected",
  PROVIDER_WITHDRAW_COMPLETED: "auditPage.statusCompleted",
  PROVIDER_WITHDRAW_CANCELLED: "auditPage.statusCancelled",
};

function extractAmount(log: FinanceAuditLog): string {
  const d = log.details ?? {};
  const delta = d.deltaAmount ?? d.amountUsdc ?? d.amount_usdc;
  if (typeof delta === "number" && delta > 0) return `$${delta.toFixed(2)}`;
  if (typeof delta === "string") {
    const n = parseFloat(delta);
    if (!isNaN(n) && n > 0) return `$${n.toFixed(2)}`;
  }
  const after = d.afterBalance;
  const before = d.beforeBalance;
  if (typeof after === "string" && typeof before === "string") {
    const diff = Math.abs(parseFloat(after) - parseFloat(before));
    if (diff > 0) return `$${diff.toFixed(2)}`;
  }
  return "—";
}

function getStatusStyle(action: string): string {
  if (action.includes("COMPLETED") || action.includes("CONFIRMED")) {
    return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  }
  if (action.includes("REJECTED") || action.includes("CANCELLED")) {
    return "text-red-400 bg-red-500/10 border-red-500/20";
  }
  if (action.includes("APPROVED")) {
    return "text-blue-400 bg-blue-500/10 border-blue-500/20";
  }
  return "text-amber-400 bg-amber-500/10 border-amber-500/20"; // pending
}

function formatRelativeTime(
  value: RelativeTime,
  t: (key: string, vars?: Record<string, string | number>, fallbackText?: string) => string,
): string {
  if (value.unit === "minutes") {
    return t("auditPage.relativeMinutesAgo", { count: value.count });
  }
  if (value.unit === "hours") {
    return t("auditPage.relativeHoursAgo", { count: value.count });
  }
  return t("auditPage.relativeDaysAgo", { count: value.count });
}

const DEFAULT_OVERVIEW: RiskOverview = {
  systemIntegrity: { level: "green", anomalyCount24h: 0 },
  pendingReviews: { level: "green", count: 0 },
  alerts: [],
};

export default function RiskAuditPage() {
  const { t } = useLanguage();
  const { address, isConnected } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const [auditLogs, setAuditLogs] = useState<AuditTrailRecord[]>([]);
  const [overview, setOverview] = useState<RiskOverview>(DEFAULT_OVERVIEW);

  useEffect(() => {
    if (!isConnected || !isSessionAuthenticated || !address) return;
    const headers = buildAuthedHeaders(address);

    fetch(`${getGatewayBaseUrl()}/api/v1/finance/risk-overview`, { headers })
      .then((r) => r.json())
      .then((data: { overview?: RiskOverview }) => {
        if (data.overview) setOverview(data.overview);
      })
      .catch(() => {});

    fetch(`${getGatewayBaseUrl()}/api/v1/finance/audit-logs?limit=10`, { headers })
      .then((r) => r.json())
      .then((data: { logs?: FinanceAuditLog[] }) => {
        const logs = data.logs ?? [];
        setAuditLogs(
          logs.map((log) => ({
            id: log.id,
            actionKey: ACTION_I18N_MAP[log.action] || "",
            rawAction: log.action,
            amount: extractAmount(log),
            statusKey: ACTION_STATUS_MAP[log.action] || "auditPage.statusPending",
            time: toRelativeTime(log.timestamp),
          }))
        );
      })
      .catch(() => {});
  }, [isConnected, isSessionAuthenticated, address]);

  const getLevelTone = (level: string) => {
    if (level === "red") return { badge: "bg-red-500/10 border border-red-500/20", icon: "text-red-400", label: "text-red-400" };
    if (level === "yellow") return { badge: "bg-amber-500/10 border border-amber-500/20", icon: "text-amber-400", label: "text-amber-400" };
    return { badge: "bg-emerald-500/10 border border-emerald-500/20", icon: "text-emerald-400", label: "text-emerald-400" };
  };

  const integrityTone = getLevelTone(overview.systemIntegrity.level);
  const reviewTone = getLevelTone(overview.pendingReviews.level);

  const integrityLabel = overview.systemIntegrity.level === "green"
    ? t("auditPage.toneSecure")
    : overview.systemIntegrity.level === "yellow"
      ? t("auditPage.toneWarning")
      : "Critical";
  const integrityDesc = overview.systemIntegrity.anomalyCount24h === 0
    ? t("auditPage.noAnomaliesDetected")
    : t("auditPage.anomaliesDetected", { count: overview.systemIntegrity.anomalyCount24h });

  const reviewLabel = overview.pendingReviews.level === "green"
    ? t("auditPage.toneSecure")
    : t("auditPage.toneWarning");
  const reviewDesc = overview.pendingReviews.count === 0
    ? t("auditPage.pendingReviewsNone")
    : t("auditPage.pendingReviewsActive", { count: overview.pendingReviews.count });

  const getAlertTone = (severity: string) => {
    if (severity === "high") {
      return {
        badge: "bg-red-500/10 border border-red-500/20",
        icon: "text-red-400",
      };
    }
    if (severity === "medium") {
      return {
        badge: "bg-amber-500/10 border border-amber-500/20",
        icon: "text-amber-400",
      };
    }
    return {
      badge: "bg-blue-500/10 border border-blue-500/20",
      icon: "text-blue-400",
    };
  };

  return (
    <div className="p-8 space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-amber-400" />
            {t("auditPage.title")}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t("auditPage.description")}</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-bold text-white hover:bg-white/10 transition-colors">
            <Bell className="w-3.5 h-3.5 text-amber-400" />
            {t("auditPage.notificationSettings")}
          </button>
        </div>
      </div>

      {/* RISK OVERVIEW — real data */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* System Integrity */}
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className={`p-2 rounded-lg ${integrityTone.badge}`}>
              <ShieldCheck className={`w-4 h-4 ${integrityTone.icon}`} />
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-widest ${integrityTone.label}`}>{integrityLabel}</span>
          </div>
          <h3 className="text-sm font-bold text-white mb-1">{t("auditPage.systemIntegrityTitle")}</h3>
          <p className="text-xs text-gray-500">{integrityDesc}</p>
        </div>

        {/* Pending Reviews */}
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className={`p-2 rounded-lg ${reviewTone.badge}`}>
              <Zap className={`w-4 h-4 ${reviewTone.icon}`} />
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-widest ${reviewTone.label}`}>{reviewLabel}</span>
          </div>
          <h3 className="text-sm font-bold text-white mb-1">{t("auditPage.pendingReviewsTitle")}</h3>
          <p className="text-xs text-gray-500">{reviewDesc}</p>
        </div>

        {/* Anomaly Detection */}
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <Activity className="w-4 h-4 text-blue-400" />
            </div>
            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">{t("auditPage.toneNormal")}</span>
          </div>
          <h3 className="text-sm font-bold text-white mb-1">{t("auditPage.anomalyDetectionTitle")}</h3>
          <p className="text-xs text-gray-500">{t("auditPage.anomalyDetectionDescription")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* ACTIVE ALERTS — real data */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              {t("auditPage.activeAlertsTitle")}
            </h2>
          </div>
          
          <div className="space-y-4">
            {overview.alerts.length === 0 ? (
              <div className="p-6 rounded-xl bg-white/[0.02] border border-white/5 flex items-center gap-4">
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
                <p className="text-xs text-gray-500">{t("auditPage.noActiveAlerts")}</p>
              </div>
            ) : (
              overview.alerts.map((alert) => {
                const tone = getAlertTone(alert.severity);
                const relTime = toRelativeTime(alert.timestamp);
                return (
                  <div key={alert.id} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-start gap-4 group hover:bg-white/[0.04] transition-all">
                    <div className={`p-2 rounded-lg mt-0.5 ${tone.badge}`}>
                      <ShieldAlert className={`w-4 h-4 ${tone.icon}`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-sm font-bold text-white">{formatAction(alert.type)}</h4>
                        <span className="text-[10px] font-mono text-gray-600">{formatRelativeTime(relTime, t)}</span>
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed">{alert.message}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* AUDIT TRAIL */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-blue-400" />
              {t("auditPage.auditTrailTitle")}
            </h2>
            <button className="text-[10px] font-bold text-gray-500 hover:text-white transition-colors uppercase tracking-widest">{t("auditPage.exportCsv")}</button>
          </div>
          
          <div className="bg-[#0a0a0c] border border-white/5 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.02]">
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t("auditPage.tableAction")}</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t("auditPage.tableAmount")}</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t("auditPage.tableStatus")}</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t("auditPage.tableTime")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-xs text-gray-600">{t("auditPage.noAuditRecords")}</td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-white/[0.01] transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium text-white">{log.actionKey ? t(log.actionKey) : formatAction(log.rawAction)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-400 font-mono">{log.amount}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getStatusStyle(log.rawAction)}`}>
                          {t(log.statusKey)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-600">{formatRelativeTime(log.time, t)}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
