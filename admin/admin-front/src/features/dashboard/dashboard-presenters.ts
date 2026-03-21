import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import type {
  ActivityTrendSeries,
  ApprovalItem,
  DashboardOverview,
  FinanceOverview,
  OperationsOverview,
  SystemStatus,
} from "@/services/admin-api";

type SentinelMetric = {
  label: string;
  value: string;
  meta: string;
};

type OperationsItem = {
  label: string;
  value: string;
  tone: "green" | "orange" | "red";
};

type RiskActivityRow = {
  approvalId: string;
  createdAt: string;
  threatLevel: string;
  source: string;
  actionTaken: string;
};

type CapitalSnapshotCard = {
  label: string;
  value: string;
};

const HIGHLIGHT_META_BY_TREND: Record<string, string> = {
  stable: "读模型当前稳定，可以继续保持值班观察。",
  monitor: "读模型当前稳定，可以继续保持值班观察。",
  requires_attention: "该指标已进入异常范围，优先处理避免扩散。",
};

export function buildSentinelMetrics(
  overview: DashboardOverview | null,
  operationsOverview: OperationsOverview | null,
): SentinelMetric[] {
  const highlightMetrics = (overview?.highlights ?? []).slice(0, 3).map((item, index) => ({
    label: `SENTINEL 0${index + 1}`,
    value: `${item.title} ${item.value}`,
    meta: HIGHLIGHT_META_BY_TREND[item.trend] ?? "后端已返回该指标，等待进一步处置。",
  }));

  const fallbackMetrics: SentinelMetric[] = overview ? [
    {
      label: "SENTINEL 01",
      value: `待执行审批队列 ${overview.metrics.pendingApprovals}`,
      meta: HIGHLIGHT_META_BY_TREND.stable,
    },
    {
      label: "SENTINEL 02",
      value: `充值修复异常 ${overview.metrics.depositExceptions}`,
      meta: HIGHLIGHT_META_BY_TREND.requires_attention,
    },
    {
      label: "SENTINEL 03",
      value: `审计告警 ${overview.metrics.auditAlerts}`,
      meta: HIGHLIGHT_META_BY_TREND.requires_attention,
    },
  ] : [
    {
      label: "SENTINEL 01",
      value: "待执行审批队列 0",
      meta: HIGHLIGHT_META_BY_TREND.stable,
    },
    {
      label: "SENTINEL 02",
      value: "充值修复异常 0",
      meta: HIGHLIGHT_META_BY_TREND.requires_attention,
    },
    {
      label: "SENTINEL 03",
      value: "审计告警 0",
      meta: HIGHLIGHT_META_BY_TREND.requires_attention,
    },
  ];

  return [
    ...(highlightMetrics.length === 3 ? highlightMetrics : fallbackMetrics),
    {
      label: "SENTINEL 04",
      value: `账本对账差额 ${formatUsdc(operationsOverview?.reconciliationDeltaUsdc ?? overview?.metrics.vaultLedgerDelta ?? "0")} USDC`,
      meta: "接入真实后端数据。",
    },
  ];
}

export function buildOperationsItems(
  systemStatus: SystemStatus | null,
  operationsOverview: OperationsOverview | null,
): OperationsItem[] {
  return [
    {
      label: "Gateway Admin",
      value: systemStatus?.gatewayAdmin ?? "unknown",
      tone: systemStatus?.gatewayAdmin?.toLowerCase().includes("healthy") ? "green" : "red",
    },
    {
      label: "Gateway Runtime",
      value: systemStatus?.gateway ?? "unknown",
      tone: systemStatus?.gateway?.toLowerCase().includes("healthy") ? "green" : "red",
    },
    {
      label: "Reconciliation",
      value: operationsOverview?.reconciliationAlert ? "degraded" : "nominal",
      tone: operationsOverview?.reconciliationAlert ? "red" : "green",
    },
    {
      label: "Execution Queue",
      value: (systemStatus?.approvalQueueDepth ?? 0) > 0 ? "active" : "nominal",
      tone: (systemStatus?.approvalQueueDepth ?? 0) > 0 ? "orange" : "green",
    },
  ];
}

export function buildRiskActivityRows(approvals: ApprovalItem[]): RiskActivityRow[] {
  return approvals.map((item) => {
    let threatLevel = "monitoring";
    if (item.approvalLevel.toLowerCase().includes("high")) {
      threatLevel = "critical";
    } else if (item.status.toLowerCase().includes("pending")) {
      threatLevel = "elevated";
    }
    const actionTaken = item.status.toLowerCase().includes("pending") ? "await review" : item.status;
    return {
      approvalId: item.approvalId,
      createdAt: formatDateTime(item.createdAt),
      threatLevel,
      source: item.requesterRole,
      actionTaken,
    };
  });
}

export function buildCapitalSnapshotCards(financeOverview: FinanceOverview | null): CapitalSnapshotCard[] {
  if (!financeOverview) {
    return [];
  }

  return [
    { label: "Today charge", value: `${formatUsdc(financeOverview.todayChargeUsdc)} USDC` },
    { label: "Today deposit", value: `${formatUsdc(financeOverview.todayDepositUsdc)} USDC` },
    { label: "Today refund", value: `${formatUsdc(financeOverview.todayRefundUsdc)} USDC` },
    { label: "Today withdrawal", value: `${formatUsdc(financeOverview.todayWithdrawalUsdc)} USDC` },
    { label: "Owner liability", value: `${formatUsdc(financeOverview.ownerLiabilityUsdc)} USDC` },
    { label: "Provider payable", value: `${formatUsdc(financeOverview.providerPayableUsdc)} USDC` },
    { label: "Platform fee balance", value: `${formatUsdc(financeOverview.platformFeeBalanceUsdc)} USDC` },
    { label: "Vault ledger delta", value: `${formatUsdc(financeOverview.vaultLedgerDeltaUsdc)} USDC` },
    { label: "Pending deposits", value: String(financeOverview.pendingDepositCount) },
    { label: "Pending withdrawals", value: String(financeOverview.pendingWithdrawalCount) },
  ];
}

export function resolveReadModelTimestamp(
  financeOverview: FinanceOverview | null,
  operationsOverview: OperationsOverview | null,
  systemStatus: SystemStatus | null,
): string {
  const timestamp = financeOverview?.projectedAt ?? operationsOverview?.projectedAt ?? systemStatus?.lastReconciliationAt ?? null;
  return timestamp ? formatDateTime(timestamp) : "projection pending";
}

export function resolveProjectionNarrative(
  overview: DashboardOverview | null,
  activityTrends: ActivityTrendSeries | null,
  operationsOverview: OperationsOverview | null,
): string {
  if (operationsOverview?.reconciliationLastError) {
    return `reconciliation signal: ${operationsOverview.reconciliationLastError}`;
  }

  if (overview && activityTrends && operationsOverview) {
    return `overview ${overview.metrics.pendingApprovals} / trends ${activityTrends.points.length}d / gateway ${operationsOverview.gatewayStatus}`;
  }

  return "等待 gateway-admin 返回完整投影快照。";
}