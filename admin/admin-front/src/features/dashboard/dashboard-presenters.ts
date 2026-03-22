import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import { getFinanceMetricGlossary } from "@/features/finance/finance-glossary";
import { getDiagnosticSummaryText } from "@/features/diagnostics/diagnostic-presenters";
import type {
  ActivityTrendSeries,
  ApprovalItem,
  DashboardOverview,
  DashboardDiagnostics,
  FinanceOverview,
  OperationsOverview,
  ReconciliationDetail,
  SystemStatus,
} from "@/services/admin-api";

type SentinelMetric = {
  label: string;
  value: string;
  meta: string;
  href?: string;
  actionLabel?: string;
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
  key: string;
  label: string;
  value: string;
  hint: string;
};

type DashboardPressureCard = {
  key: string;
  label: string;
  value: string;
  hint: string;
};

type DashboardFunnelCard = {
  key: string;
  title: string;
  value: string;
  detail: string;
  tone: "green" | "orange" | "red" | "gray";
  href?: string;
};

type DashboardBusinessLaneCard = {
  key: string;
  title: string;
  summary: string;
  detail: string;
  tone: DashboardTone;
  href: string;
  actionLabel: string;
};

type DashboardTone = "green" | "orange" | "red" | "gray";

function resolveDeltaTone(delta: number): DashboardTone {
  if (delta > 100) {
    return "red";
  }

  if (delta > 0.01) {
    return "orange";
  }

  return "green";
}

function resolveCountTone(count: number, criticalThreshold: number): DashboardTone {
  if (count >= criticalThreshold) {
    return "red";
  }

  if (count > 0) {
    return "orange";
  }

  return "green";
}

function buildApprovalLaneCard(pendingApprovals: number): DashboardBusinessLaneCard {
  const hasPendingApprovals = pendingApprovals > 0;

  return {
    key: "approval-lane",
    title: "审批进展",
    summary: hasPendingApprovals ? `${pendingApprovals} 项待审核` : "当前无待审核事项",
    detail: hasPendingApprovals ? "仍有事项等待审核人处理，相关业务动作可能会被延后。" : "当前审批队列顺畅，没有需要立即介入的高风险事项。",
    tone: resolveCountTone(pendingApprovals, 8),
    href: "/approvals",
    actionLabel: "打开审批中心",
  };
}

function buildDepositLaneCard(
  pendingDeposits: number,
  depositExceptions: number,
  chainNotLedger: number,
): DashboardBusinessLaneCard {
  const hasDepositException = depositExceptions > 0 || chainNotLedger > 0;

  return {
    key: "deposit-lane",
    title: "充值进展",
    summary: hasDepositException ? `${depositExceptions} 项异常，${chainNotLedger} 笔待同步` : `${pendingDeposits} 笔待确认充值`,
    detail: hasDepositException ? "充值环节已经出现异常或同步延迟，建议尽快查看对账明细。" : "当前充值主要表现为待确认压力，暂无明显异常。",
    tone: hasDepositException ? "red" : resolveCountTone(pendingDeposits, Number.MAX_SAFE_INTEGER),
    href: "/finance/reconciliation",
    actionLabel: "查看充值对账",
  };
}

function buildOutflowLaneCard(
  pendingWithdrawals: number,
  todayRefundUsdc: string | number | null | undefined,
  todayWithdrawalUsdc: string | number | null | undefined,
): DashboardBusinessLaneCard {
  const hasPendingWithdrawals = pendingWithdrawals > 0;

  return {
    key: "outflow-lane",
    title: "出账进展",
    summary: hasPendingWithdrawals
      ? `${pendingWithdrawals} 笔待处理提现`
      : `退款 ${formatUsdc(todayRefundUsdc ?? 0)} / 提现 ${formatUsdc(todayWithdrawalUsdc ?? 0)} USDC`,
    detail: hasPendingWithdrawals ? "当前仍有退款或提现事项等待处理，建议关注出账时效。" : "今天退款和提现节奏正常，没有形成明显积压。",
    tone: resolveCountTone(pendingWithdrawals, 5),
    href: "/withdrawal-reviews",
    actionLabel: "打开出账审核",
  };
}

function buildReconciliationLaneCard(reconciliationDelta: number, auditAlerts: number): DashboardBusinessLaneCard {
  const hasDrift = Math.abs(reconciliationDelta) > 0.01;
  const hasAuditAlerts = auditAlerts > 0;

  let summary = "当前对账正常";
  let detail = "目前没有看到明显的资金差异或异常提醒。";

  if (hasDrift) {
    summary = `存在 ${formatUsdc(reconciliationDelta)} USDC 差额`;
    detail = "当前账目存在差异，建议尽快进入对账明细查看原因。";
  } else if (hasAuditAlerts) {
    summary = `${auditAlerts} 条风险提醒`;
    detail = "虽然账目当前基本正常，但已有风险提醒，需要持续关注。";
  }

  let tone: DashboardTone = "green";
  if (hasDrift) {
    tone = "red";
  } else if (hasAuditAlerts) {
    tone = "orange";
  }

  return {
    key: "reconciliation-lane",
    title: "对账情况",
    summary,
    detail,
    tone,
    href: "/finance/reconciliation",
    actionLabel: "打开对账详情",
  };
}

const HIGHLIGHT_META_BY_TREND: Record<string, string> = {
  stable: "读模型当前稳定，可以继续保持值班观察。",
  monitor: "读模型当前稳定，可以继续保持值班观察。",
  requires_attention: "该指标已进入异常范围，优先处理避免扩散。",
};

function resolveOverviewVerdictLabel(
  status: string | null | undefined,
  reconciliationDelta: number,
  treasuryAbsoluteDelta: number | null,
): string {
  if (treasuryAbsoluteDelta !== null && treasuryAbsoluteDelta <= 0.01 && reconciliationDelta > 0.01) {
    return "继续观察";
  }

  const normalized = status?.toLowerCase() ?? "";

  if (normalized === "degraded") {
    return "需要处理";
  }

  if (normalized === "monitoring") {
    return "持续观察";
  }

  if (normalized === "nominal" || normalized === "healthy") {
    return "运行正常";
  }

  if (normalized === "pending") {
    return "待诊断";
  }

  return status ?? "待诊断";
}

function resolveOverviewVerdictMeta(
  status: string | null | undefined,
  reconciliationDelta: number,
  treasuryAbsoluteDelta: number | null,
  fallbackSummary: string | null | undefined,
): string {
  const normalized = status?.toLowerCase() ?? "";

  if (treasuryAbsoluteDelta !== null && treasuryAbsoluteDelta <= 0.01 && reconciliationDelta > 0.01) {
    return `当前客户侧余额与链上资金相差 ${formatUsdc(reconciliationDelta)} USDC，但平台整体总账已经对齐，通常是正常消费或收入沉淀造成，可先持续观察。`;
  }

  if (treasuryAbsoluteDelta !== null && treasuryAbsoluteDelta > 0.01) {
    return `当前平台总账还有 ${formatUsdc(treasuryAbsoluteDelta)} USDC 未对齐，建议优先核对客户余额、待结算款和平台收入是否一致。`;
  }

  if (reconciliationDelta > 0.01) {
    return `当前发现账面记录与链上余额存在 ${formatUsdc(reconciliationDelta)} USDC 差异，建议先查看对账明细确认来源。`;
  }

  if (normalized === "nominal" || normalized === "healthy") {
    return "当前没有发现需要立刻升级的系统或资金异常。";
  }

  if (normalized === "monitoring") {
    return "当前存在需要持续观察的信号，建议关注审批队列与对账链路。";
  }

  if (normalized === "degraded") {
    return getDiagnosticSummaryText(fallbackSummary) ?? "控制面已经发现异常信号，建议优先查看系统健康摘要与对账详情。";
  }

  return getDiagnosticSummaryText(fallbackSummary) ?? "统一诊断语义层当前尚未返回状态摘要。";
}

export function buildSentinelMetrics(
  overview: DashboardOverview | null,
  operationsOverview: OperationsOverview | null,
  diagnostics: DashboardDiagnostics | null,
  reconciliationDetail: ReconciliationDetail | null,
): SentinelMetric[] {
  const reconciliationDelta = Math.abs(Number(operationsOverview?.reconciliationDeltaUsdc ?? overview?.metrics.vaultLedgerDelta ?? "0"));
  const treasuryAbsoluteDelta = reconciliationDetail
    ? Math.abs(
        Number(reconciliationDetail.chainVaultUsdc ?? 0)
        - (
          Number(reconciliationDetail.ownerLiabilityUsdc)
          + Number(reconciliationDetail.providerPayableUsdc)
          + Number(reconciliationDetail.platformFeeBalanceUsdc)
        ),
      )
    : null;

  return [
    {
      label: "当前值班结论",
      value: resolveOverviewVerdictLabel(diagnostics?.overallStatus, reconciliationDelta, treasuryAbsoluteDelta),
      meta: resolveOverviewVerdictMeta(diagnostics?.overallStatus, reconciliationDelta, treasuryAbsoluteDelta, diagnostics?.summary),
    },
    {
      label: "客户资金与链上差额",
      value: `${formatUsdc(reconciliationDelta)} USDC`,
      meta: "这里反映客户侧账面资金与链上余额当前相差多少，需要结合平台总账差额一起判断是否异常。",
      href: "/finance/reconciliation",
      actionLabel: "查看差额来源",
    },
    {
      label: "平台总账差额",
      value: treasuryAbsoluteDelta === null ? "待接线" : `${formatUsdc(treasuryAbsoluteDelta)} USDC`,
      meta: treasuryAbsoluteDelta === null ? "当前首页尚未拿到完整总账数据。" : "把链上资金、客户余额、待结算款和平台收入放在一起看是否平衡；为 0 表示整体对齐。",
      href: "/finance",
      actionLabel: "查看总账拆分",
    },
    {
      label: "待处理审批",
      value: `${overview?.metrics.pendingApprovals ?? 0}`,
      meta: "当前等待业务或风控审核的事项数量。",
      href: "/approvals",
      actionLabel: "打开审批中心",
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
    { key: "today-charge", label: getFinanceMetricGlossary("todayCharge").label, value: `${formatUsdc(financeOverview.todayChargeUsdc)} USDC`, hint: getFinanceMetricGlossary("todayCharge").hint },
    { key: "today-deposit", label: getFinanceMetricGlossary("todayDeposit").label, value: `${formatUsdc(financeOverview.todayDepositUsdc)} USDC`, hint: getFinanceMetricGlossary("todayDeposit").hint },
    { key: "today-refund", label: getFinanceMetricGlossary("todayRefund").label, value: `${formatUsdc(financeOverview.todayRefundUsdc)} USDC`, hint: getFinanceMetricGlossary("todayRefund").hint },
    { key: "today-withdrawal", label: getFinanceMetricGlossary("todayWithdrawal").label, value: `${formatUsdc(financeOverview.todayWithdrawalUsdc)} USDC`, hint: getFinanceMetricGlossary("todayWithdrawal").hint },
    { key: "owner-liability", label: getFinanceMetricGlossary("ownerLiability").label, value: `${formatUsdc(financeOverview.ownerLiabilityUsdc)} USDC`, hint: getFinanceMetricGlossary("ownerLiability").hint },
    { key: "provider-payable", label: getFinanceMetricGlossary("providerPayable").label, value: `${formatUsdc(financeOverview.providerPayableUsdc)} USDC`, hint: getFinanceMetricGlossary("providerPayable").hint },
    { key: "platform-income", label: getFinanceMetricGlossary("platformIncome").label, value: `${formatUsdc(financeOverview.platformFeeBalanceUsdc)} USDC`, hint: getFinanceMetricGlossary("platformIncome").hint },
    { key: "vault-ledger-delta", label: getFinanceMetricGlossary("vaultLedgerDelta").label, value: `${formatUsdc(financeOverview.vaultLedgerDeltaUsdc)} USDC`, hint: getFinanceMetricGlossary("vaultLedgerDelta").hint },
    { key: "pending-deposits", label: getFinanceMetricGlossary("pendingDeposits").label, value: String(financeOverview.pendingDepositCount), hint: getFinanceMetricGlossary("pendingDeposits").hint },
    { key: "pending-withdrawals", label: getFinanceMetricGlossary("pendingWithdrawals").label, value: String(financeOverview.pendingWithdrawalCount), hint: getFinanceMetricGlossary("pendingWithdrawals").hint },
  ];
}

export function buildDashboardFlowCards(financeOverview: FinanceOverview | null): CapitalSnapshotCard[] {
  if (!financeOverview) {
    return [];
  }

  return [
    {
      key: "today-deposit",
      label: "今日充值",
      value: `${formatUsdc(financeOverview.todayDepositUsdc)} USDC`,
      hint: "今天已经确认入账的充值金额。",
    },
    {
      key: "today-charge",
      label: "今日扣费",
      value: `${formatUsdc(financeOverview.todayChargeUsdc)} USDC`,
      hint: "今天已经确认的服务消费金额。",
    },
    {
      key: "today-refund",
      label: "今日退款",
      value: `${formatUsdc(financeOverview.todayRefundUsdc)} USDC`,
      hint: "今天已经进入退款流程或完成退款的金额。",
    },
    {
      key: "today-withdrawal",
      label: "今日提现",
      value: `${formatUsdc(financeOverview.todayWithdrawalUsdc)} USDC`,
      hint: "今天已经进入出账流程或完成提现的金额。",
    },
  ];
}

export function buildDashboardPressureCards(
  overview: DashboardOverview | null,
  financeOverview: FinanceOverview | null,
): DashboardPressureCard[] {
  return [
    {
      key: "pending-deposits",
      label: "待确认充值",
      value: String(financeOverview?.pendingDepositCount ?? 0),
      hint: "仍在确认或等待补记的充值笔数。",
    },
    {
      key: "pending-withdrawals",
      label: "待处理提现",
      value: String(financeOverview?.pendingWithdrawalCount ?? 0),
      hint: "仍在审核或排队处理的提现笔数。",
    },
    {
      key: "deposit-exceptions",
      label: "充值异常",
      value: String(overview?.metrics.depositExceptions ?? 0),
      hint: "充值异常越多，越需要尽快核对入账情况。",
    },
    {
      key: "audit-alerts",
      label: "风险提醒",
      value: String(overview?.metrics.auditAlerts ?? 0),
      hint: "若这里有提醒，说明近期存在需要重点关注的敏感操作。",
    },
  ];
}

export function buildDashboardFunnelCards(
  financeOverview: FinanceOverview | null,
  operationsOverview: OperationsOverview | null,
  activityTrends: ActivityTrendSeries | null,
): DashboardFunnelCard[] {
  const latestTrend = activityTrends?.points.at(-1) ?? null;
  const depositDelta = Number(operationsOverview?.reconciliationDeltaUsdc ?? financeOverview?.vaultLedgerDeltaUsdc ?? 0);
  const depositTone = resolveDeltaTone(depositDelta);

  return [
    {
      key: "deposit-funnel",
      title: "充值情况摘要",
      value: `${financeOverview?.pendingDepositCount ?? 0} 笔待确认`,
      detail: `今日已入账 ${formatUsdc(financeOverview?.todayDepositUsdc ?? 0)} USDC，当前差额 ${formatUsdc(depositDelta)} USDC。`,
      tone: depositTone,
      href: "/finance/reconciliation",
    },
    {
      key: "billing-funnel",
      title: "消费扣费摘要",
      value: `今日已扣费 ${formatUsdc(financeOverview?.todayChargeUsdc ?? 0)} USDC`,
      detail: `最新净流入 ${formatUsdc(latestTrend?.netFlowUsdc ?? 0)} USDC，失败提醒 ${operationsOverview?.recentGatewayFailures ?? 0} 次。`,
      tone: (operationsOverview?.recentGatewayFailures ?? 0) > 0 ? "orange" : "green",
      href: "/finance",
    },
    {
      key: "outflow-funnel",
      title: "退款提现摘要",
      value: `退款 ${formatUsdc(financeOverview?.todayRefundUsdc ?? 0)} / 提现 ${formatUsdc(financeOverview?.todayWithdrawalUsdc ?? 0)} USDC`,
      detail: `当前还有 ${financeOverview?.pendingWithdrawalCount ?? 0} 笔提现待处理。`,
      tone: (financeOverview?.pendingWithdrawalCount ?? 0) > 0 ? "orange" : "green",
      href: "/finance",
    },
  ];
}

export function buildBusinessRuntimeLaneCards(
  overview: DashboardOverview | null,
  financeOverview: FinanceOverview | null,
  reconciliationDetail: ReconciliationDetail | null,
): DashboardBusinessLaneCard[] {
  const pendingApprovals = overview?.metrics.pendingApprovals ?? 0;
  const pendingDeposits = financeOverview?.pendingDepositCount ?? 0;
  const pendingWithdrawals = financeOverview?.pendingWithdrawalCount ?? 0;
  const depositExceptions = overview?.metrics.depositExceptions ?? 0;
  const chainNotLedger = reconciliationDetail?.chainConfirmedNotLedgerConfirmedCount ?? 0;
  const auditAlerts = overview?.metrics.auditAlerts ?? 0;
  const reconciliationDelta = Number(reconciliationDetail?.reconciliationDeltaUsdc ?? financeOverview?.vaultLedgerDeltaUsdc ?? 0);

  return [
    buildApprovalLaneCard(pendingApprovals),
    buildDepositLaneCard(pendingDeposits, depositExceptions, chainNotLedger),
    buildOutflowLaneCard(pendingWithdrawals, financeOverview?.todayRefundUsdc, financeOverview?.todayWithdrawalUsdc),
    buildReconciliationLaneCard(reconciliationDelta, auditAlerts),
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