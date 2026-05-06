"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  History,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";

export type Translator = (
  key: string,
  vars?: Record<string, string | number>,
  fallbackText?: string
) => string;

export type RelativeTime = {
  unit: "minutes" | "hours" | "days";
  count: number;
};

export type AuditAlert = {
  id: string;
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
  timestamp: number;
};

export type RiskOverview = {
  systemIntegrity: { level: string; anomalyCount24h: number };
  pendingReviews: { level: string; count: number };
  alerts: AuditAlert[];
};

export type AuditTrailRecord = {
  id: string;
  actionKey: string;
  rawAction: string;
  amount: string;
  statusKey: string;
  time: RelativeTime;
};

type Tone = {
  badge: string;
  icon: string;
  label?: string;
};

export function toRelativeTime(timestamp: number): RelativeTime {
  const diffSec = Math.floor(Date.now() / 1000) - timestamp;
  if (diffSec < 3600) {
    return { unit: "minutes", count: Math.max(1, Math.floor(diffSec / 60)) };
  }
  if (diffSec < 86400) {
    return { unit: "hours", count: Math.max(1, Math.floor(diffSec / 3600)) };
  }
  return { unit: "days", count: Math.max(1, Math.floor(diffSec / 86400)) };
}

function formatAction(action: string): string {
  return action
    .replaceAll("_", " ")
    .toLowerCase()
    .replaceAll(/\b\w/g, (c) => c.toUpperCase());
}

function getLevelTone(level: string): Required<Tone> {
  if (level === "red") {
    return {
      badge: "bg-red-500/10 border border-red-500/20",
      icon: "text-red-400",
      label: "text-red-400",
    };
  }
  if (level === "yellow") {
    return {
      badge: "bg-amber-500/10 border border-amber-500/20",
      icon: "text-amber-400",
      label: "text-amber-400",
    };
  }
  return {
    badge: "bg-emerald-500/10 border border-emerald-500/20",
    icon: "text-emerald-400",
    label: "text-emerald-400",
  };
}

function getAlertTone(severity: string): Tone {
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
  return "text-amber-400 bg-amber-500/10 border-amber-500/20";
}

function formatRelativeTime(value: RelativeTime, t: Translator): string {
  if (value.unit === "minutes") {
    return t("auditPage.relativeMinutesAgo", { count: value.count });
  }
  if (value.unit === "hours") {
    return t("auditPage.relativeHoursAgo", { count: value.count });
  }
  return t("auditPage.relativeDaysAgo", { count: value.count });
}

export function AuditPageHeader({ t }: Readonly<{ t: Translator }>) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-amber-400" />
          {t("auditPage.title")}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {t("auditPage.description")}
        </p>
      </div>

      <button className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-bold text-white hover:bg-white/10 transition-colors">
        <Bell className="w-3.5 h-3.5 text-amber-400" />
        {t("auditPage.notificationSettings")}
      </button>
    </div>
  );
}

function RiskCard({
  children,
  desc,
  icon,
  label,
  title,
  tone,
}: Readonly<{
  children?: ReactNode;
  desc: string;
  icon: ReactNode;
  label: string;
  title: string;
  tone: Required<Tone>;
}>) {
  return (
    <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-2 rounded-lg ${tone.badge}`}>{icon}</div>
        <span
          className={`text-[10px] font-bold uppercase tracking-widest ${tone.label}`}
        >
          {label}
        </span>
      </div>
      <h3 className="text-sm font-bold text-white mb-1">{title}</h3>
      <p className="text-xs text-gray-500">{desc}</p>
      {children}
    </div>
  );
}

export function RiskOverviewCards({
  overview,
  t,
}: Readonly<{ overview: RiskOverview; t: Translator }>) {
  const integrityTone = getLevelTone(overview.systemIntegrity.level);
  const reviewTone = getLevelTone(overview.pendingReviews.level);
  const integrityLabel =
    overview.systemIntegrity.level === "green"
      ? t("auditPage.toneSecure")
      : overview.systemIntegrity.level === "yellow"
      ? t("auditPage.toneWarning")
      : "Critical";
  const integrityDesc =
    overview.systemIntegrity.anomalyCount24h === 0
      ? t("auditPage.noAnomaliesDetected")
      : t("auditPage.anomaliesDetected", {
          count: overview.systemIntegrity.anomalyCount24h,
        });
  const reviewLabel =
    overview.pendingReviews.level === "green"
      ? t("auditPage.toneSecure")
      : t("auditPage.toneWarning");
  const reviewDesc =
    overview.pendingReviews.count === 0
      ? t("auditPage.pendingReviewsNone")
      : t("auditPage.pendingReviewsActive", {
          count: overview.pendingReviews.count,
        });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <RiskCard
        desc={integrityDesc}
        icon={<ShieldCheck className={`w-4 h-4 ${integrityTone.icon}`} />}
        label={integrityLabel}
        title={t("auditPage.systemIntegrityTitle")}
        tone={integrityTone}
      />
      <RiskCard
        desc={reviewDesc}
        icon={<Zap className={`w-4 h-4 ${reviewTone.icon}`} />}
        label={reviewLabel}
        title={t("auditPage.pendingReviewsTitle")}
        tone={reviewTone}
      />
      <RiskCard
        desc={t("auditPage.anomalyDetectionDescription")}
        icon={<Activity className="w-4 h-4 text-blue-400" />}
        label={t("auditPage.toneNormal")}
        title={t("auditPage.anomalyDetectionTitle")}
        tone={{
          badge: "bg-blue-500/10 border border-blue-500/20",
          icon: "text-blue-400",
          label: "text-blue-400",
        }}
      />
    </div>
  );
}

export function ActiveAlertsPanel({
  alerts,
  t,
}: Readonly<{ alerts: AuditAlert[]; t: Translator }>) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-white flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-400" />
        {t("auditPage.activeAlertsTitle")}
      </h2>

      <div className="space-y-4">
        {alerts.length === 0 ? (
          <div className="p-6 rounded-xl bg-white/[0.02] border border-white/5 flex items-center gap-4">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-xs text-gray-500">
              {t("auditPage.noActiveAlerts")}
            </p>
          </div>
        ) : (
          alerts.map((alert) => <AlertRow key={alert.id} alert={alert} t={t} />)
        )}
      </div>
    </div>
  );
}

function AlertRow({
  alert,
  t,
}: Readonly<{ alert: AuditAlert; t: Translator }>) {
  const tone = getAlertTone(alert.severity);
  const relTime = toRelativeTime(alert.timestamp);
  return (
    <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-start gap-4 group hover:bg-white/[0.04] transition-all">
      <div className={`p-2 rounded-lg mt-0.5 ${tone.badge}`}>
        <ShieldAlert className={`w-4 h-4 ${tone.icon}`} />
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-sm font-bold text-white">
            {formatAction(alert.type)}
          </h4>
          <span className="text-[10px] font-mono text-gray-600">
            {formatRelativeTime(relTime, t)}
          </span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">{alert.message}</p>
      </div>
    </div>
  );
}

export function AuditTrailPanel({
  logs,
  t,
}: Readonly<{ logs: AuditTrailRecord[]; t: Translator }>) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <History className="w-5 h-5 text-blue-400" />
          {t("auditPage.auditTrailTitle")}
        </h2>
        <button className="text-[10px] font-bold text-gray-500 hover:text-white transition-colors uppercase tracking-widest">
          {t("auditPage.exportCsv")}
        </button>
      </div>

      <div className="bg-[#0a0a0c] border border-white/5 rounded-xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.02]">
              <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                {t("auditPage.tableAction")}
              </th>
              <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                {t("auditPage.tableAmount")}
              </th>
              <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                {t("auditPage.tableStatus")}
              </th>
              <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                {t("auditPage.tableTime")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {logs.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-xs text-gray-600"
                >
                  {t("auditPage.noAuditRecords")}
                </td>
              </tr>
            ) : (
              logs.map((log) => <AuditTrailRow key={log.id} log={log} t={t} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditTrailRow({
  log,
  t,
}: Readonly<{ log: AuditTrailRecord; t: Translator }>) {
  return (
    <tr className="hover:bg-white/[0.01] transition-colors">
      <td className="px-4 py-3">
        <span className="text-xs font-medium text-white">
          {log.actionKey ? t(log.actionKey) : formatAction(log.rawAction)}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-gray-400 font-mono">{log.amount}</span>
      </td>
      <td className="px-4 py-3">
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getStatusStyle(
            log.rawAction
          )}`}
        >
          {t(log.statusKey)}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-gray-600">
          {formatRelativeTime(log.time, t)}
        </span>
      </td>
    </tr>
  );
}
