import type { DashboardDiagnosticAction, DashboardDiagnosticSignal } from "@/services/admin-api";

const diagnosticSummaryExactMap: Record<string, string> = {
  "gateway degraded and reconciliation alert present": "当前网关运行存在异常，且对账已触发提醒，建议优先排查系统状态和资金差异。",
  "reconciliation alert present": "当前对账已出现提醒，建议优先核对账面记录与链上资金是否一致。",
};

const diagnosticDetailExactMap: Record<string, string> = {
  "delta mismatch": "账面记录和实际资金不一致，需要进一步核对。",
  "inspect runtime state": "建议进入系统状态页查看当前运行情况。",
  "pending reviews": "当前还有事项等待人工审核，请关注处理进度。",
  "heartbeat lost": "系统心跳异常，说明该模块当前可能未正常工作。",
  healthy: "当前状态正常，无需额外处理。",
};

const diagnosticLabelExactMap: Record<string, string> = {
  "Reconciliation drift": "对账差异",
  "Open system center": "打开系统状态页",
  "Approval queue": "审批队列",
  "Gateway runtime": "网关运行状态",
  "Audit stream": "审计提醒",
};

const diagnosticSummaryReplacementRules = [
  ["gateway admin", "后台控制面"],
  ["gateway runtime", "网关运行面"],
  ["gateway", "网关"],
  ["reconciliation", "对账"],
  ["approval queue", "审批队列"],
  ["degraded", "状态异常"],
  ["monitoring", "需要持续关注"],
  ["nominal", "运行正常"],
  ["healthy", "运行正常"],
  ["alert present", "已出现提醒"],
  ["present", "存在"],
  ["and", "且"],
  ["signal", "信号"],
  ["runtime", "运行状态"],
  ["summary", "摘要"],
] as const;

const diagnosticDetailReplacementRules = [
  ["delta mismatch", "账面记录和实际资金不一致"],
  ["inspect runtime state", "查看当前运行情况"],
  ["pending reviews", "有事项等待人工审核"],
  ["heartbeat lost", "系统心跳异常"],
  ["healthy", "当前状态正常"],
  ["gateway admin", "后台控制面"],
  ["gateway runtime", "网关运行面"],
  ["gateway", "网关"],
  ["reconciliation", "对账"],
  ["approval queue", "审批队列"],
  ["runtime state", "运行状态"],
  ["runtime", "运行状态"],
  ["manual review", "人工审核"],
  ["review", "审核"],
  ["alert", "提醒"],
  ["warning", "预警"],
] as const;

const diagnosticLabelReplacementRules = [
  ["reconciliation drift", "对账差异"],
  ["reconciliation", "对账"],
  ["approval queue", "审批队列"],
  ["gateway runtime", "网关运行状态"],
  ["gateway admin", "后台控制面"],
  ["gateway", "网关"],
  ["audit stream", "审计提醒"],
  ["audit", "审计"],
  ["stream", "状态"],
  ["open system center", "打开系统状态页"],
  ["open", "打开"],
  ["system center", "系统状态页"],
  ["runtime", "运行状态"],
] as const;

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

export function getDiagnosticTone(status: string | null | undefined): "green" | "orange" | "red" | "gray" {
  if (status === "nominal") {
    return "green";
  }
  if (status === "monitoring") {
    return "orange";
  }
  if (status === "degraded") {
    return "red";
  }
  return "gray";
}

export function getDiagnosticStatusLabel(status: string | null | undefined): string {
  if (status === "nominal" || status === "healthy" || status === "active") {
    return "运行正常";
  }

  if (status === "monitoring" || status === "warning") {
    return "需要关注";
  }

  if (status === "degraded" || status === "alert") {
    return "尽快处理";
  }

  if (status === "pending") {
    return "待确认";
  }

  return status ?? "待确认";
}

export function getDiagnosticSummaryText(summary: string | null | undefined): string | null {
  if (!summary) {
    return null;
  }

  const trimmed = summary.trim();
  if (!trimmed) {
    return null;
  }

  if (containsChinese(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.toLowerCase();
  const exactMatch = diagnosticSummaryExactMap[normalized];
  if (exactMatch) {
    return exactMatch;
  }

  const rewritten = diagnosticSummaryReplacementRules.reduce((current, [source, target]) => {
    return current.replaceAll(new RegExp(source, "gi"), target);
  }, trimmed);

  return rewritten === trimmed
    ? `当前系统提示：${trimmed}`
    : rewritten;
}

export function getDiagnosticDetailText(detail: string | null | undefined): string | null {
  if (!detail) {
    return null;
  }

  const trimmed = detail.trim();
  if (!trimmed) {
    return null;
  }

  if (containsChinese(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.toLowerCase();
  const exactMatch = diagnosticDetailExactMap[normalized];
  if (exactMatch) {
    return exactMatch;
  }

  const rewritten = diagnosticDetailReplacementRules.reduce((current, [source, target]) => {
    return current.replaceAll(new RegExp(source, "gi"), target);
  }, trimmed);

  return rewritten === trimmed
    ? `当前提醒：${trimmed}`
    : rewritten;
}

export function getDiagnosticLabelText(label: string | null | undefined): string | null {
  if (!label) {
    return null;
  }

  const trimmed = label.trim();
  if (!trimmed) {
    return null;
  }

  if (containsChinese(trimmed)) {
    return trimmed;
  }

  const exactMatch = diagnosticLabelExactMap[trimmed];
  if (exactMatch) {
    return exactMatch;
  }

  const rewritten = diagnosticLabelReplacementRules.reduce((current, [source, target]) => {
    return current.replaceAll(new RegExp(source, "gi"), target);
  }, trimmed);

  return rewritten === trimmed
    ? `系统提醒`
    : rewritten;
}

export function buildDiagnosticSignalCards(signals: DashboardDiagnosticSignal[]) {
  return signals.map((signal) => ({
    key: signal.signalId,
    label: getDiagnosticLabelText(signal.label) ?? signal.label,
    value: signal.value,
    detail: getDiagnosticDetailText(signal.detail) ?? signal.detail,
    status: signal.status,
    tone: getDiagnosticTone(signal.status),
  }));
}

export function buildDiagnosticActionCards(actions: DashboardDiagnosticAction[]) {
  return actions.map((action) => ({
    key: action.actionId,
    label: getDiagnosticLabelText(action.label) ?? action.label,
    detail: getDiagnosticDetailText(action.detail) ?? action.detail,
    href: action.href,
    status: action.status,
    tone: getDiagnosticTone(action.status),
  }));
}

export function buildPrioritizedDiagnosticSignalCards(signals: DashboardDiagnosticSignal[], limit = 3) {
  const priorityByStatus: Record<string, number> = {
    degraded: 0,
    monitoring: 1,
    nominal: 2,
  };

  return buildDiagnosticSignalCards(signals)
    .sort((left, right) => {
      const toneDelta = (priorityByStatus[left.status] ?? 9) - (priorityByStatus[right.status] ?? 9);
      if (toneDelta !== 0) {
        return toneDelta;
      }
      return left.label.localeCompare(right.label);
    })
    .slice(0, limit);
}