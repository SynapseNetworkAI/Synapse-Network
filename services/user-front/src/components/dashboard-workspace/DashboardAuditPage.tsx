"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck, ShieldAlert, Activity, Bell, Zap, History } from "lucide-react";
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
  time: RelativeTime;
};

type AuditTrailRecord = {
  id: string;
  action: string;
  actor: string;
  target: string;
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

function extractTarget(log: FinanceAuditLog): string {
  const d = log.details ?? {};
  if (typeof d.txHash === "string") return d.txHash.slice(0, 16) + "…";
  if (typeof d.agentId === "string") {
    const parts = d.agentId.split(":");
    return (parts.at(-1) ?? d.agentId).slice(0, 16) + "…";
  }
  if (typeof d.credentialId === "string") return d.credentialId.slice(0, 16) + "…";
  return log.domain;
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

export default function RiskAuditPage() {
  const { t } = useLanguage();
  const { address, isConnected } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const [auditLogs, setAuditLogs] = useState<AuditTrailRecord[]>([]);

  useEffect(() => {
    if (!isConnected || !isSessionAuthenticated || !address) return;
    const headers = buildAuthedHeaders(address);
    fetch(`${getGatewayBaseUrl()}/api/v1/finance/audit-logs?limit=10`, { headers })
      .then((r) => r.json())
      .then((data: { logs?: FinanceAuditLog[] }) => {
        const logs = data.logs ?? [];
        setAuditLogs(
          logs.map((log) => ({
            id: log.id,
            action: formatAction(log.action),
            actor: log.ownerAddress ? `${log.ownerAddress.slice(0, 6)}…${log.ownerAddress.slice(-4)}` : "—",
            target: extractTarget(log),
            time: toRelativeTime(log.timestamp),
          }))
        );
      })
      .catch(() => {});
  }, [isConnected, isSessionAuthenticated, address]);

  const alerts: AuditAlert[] = [
    { id: "alt_1", type: t("auditPage.alertBudgetWarningType"), severity: "medium", message: t("auditPage.alertBudgetWarningMessage"), time: { unit: "minutes", count: 10 } },
    { id: "alt_2", type: t("auditPage.alertRateLimitType"), severity: "low", message: t("auditPage.alertRateLimitMessage"), time: { unit: "minutes", count: 45 } },
    { id: "alt_3", type: t("auditPage.alertSecurityAlertType"), severity: "high", message: t("auditPage.alertSecurityAlertMessage"), time: { unit: "hours", count: 2 } },
  ];

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

      {/* RISK OVERVIEW */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">{t("auditPage.toneSecure")}</span>
          </div>
          <h3 className="text-sm font-bold text-white mb-1">{t("auditPage.systemIntegrityTitle")}</h3>
          <p className="text-xs text-gray-500">{t("auditPage.systemIntegrityDescription")}</p>
        </div>
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">{t("auditPage.toneWarning")}</span>
          </div>
          <h3 className="text-sm font-bold text-white mb-1">{t("auditPage.budgetComplianceTitle")}</h3>
          <p className="text-xs text-gray-500">{t("auditPage.budgetComplianceDescription")}</p>
        </div>
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
        {/* ACTIVE ALERTS */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              {t("auditPage.activeAlertsTitle")}
            </h2>
            <button className="text-[10px] font-bold text-gray-500 hover:text-white transition-colors uppercase tracking-widest">{t("auditPage.clearAll")}</button>
          </div>
          
          <div className="space-y-4">
            {alerts.map((alert) => {
              const tone = getAlertTone(alert.severity);
              return (
              <div key={alert.id} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-start gap-4 group hover:bg-white/[0.04] transition-all">
                <div className={`p-2 rounded-lg mt-0.5 ${tone.badge}`}>
                  <ShieldAlert className={`w-4 h-4 ${tone.icon}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-sm font-bold text-white">{alert.type}</h4>
                    <span className="text-[10px] font-mono text-gray-600">{formatRelativeTime(alert.time, t)}</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{alert.message}</p>
                </div>
              </div>
            );})}
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
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t("auditPage.tableActor")}</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t("auditPage.tableTarget")}</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t("auditPage.tableTime")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/[0.01] transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-white">{log.action}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-500 font-mono">{log.actor}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400">{log.target}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-600">{formatRelativeTime(log.time, t)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
