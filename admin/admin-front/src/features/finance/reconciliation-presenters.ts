import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import type {
  ProviderWithdrawReviewItem,
  ReconciliationApprovalItem,
  ReconciliationDetail,
  ReconciliationDrilldownResult,
} from "@/services/admin-api";

type ReconciliationBreakdownCard = {
  label: string;
  value: string;
  description: string;
};

type ReconciliationQueueCard = {
  label: string;
  value: string;
  description: string;
};

export type DrilldownToken = {
  kind: "ownerAddress" | "requestId" | "txHash";
  label: string;
  value: string;
};

export function describeImbalance(detail: ReconciliationDetail): string {
  const delta = formatUsdc(detail.reconciliationDeltaUsdc);

  if (detail.imbalanceDirection === "vault_deficit") {
    return `链上 vault 余额低于账本义务 ${delta} USDC，优先排查未完成入账、异常扣减或回放延迟。`;
  }

  if (detail.imbalanceDirection === "vault_surplus") {
    return `链上 vault 余额高于账本义务 ${delta} USDC，需要确认是否存在重复入金、未结转或残留资金。`;
  }

  if (detail.imbalanceDirection === "balanced") {
    return "链上 vault 与账本义务当前对齐，可继续保持值班观察。";
  }

  return "当前仅拿到稳定投影摘要，缺少 runtime state 拆解字段。";
}

export function formatSignedUsdc(value: string | null): string {
  if (!value) {
    return "n/a";
  }

  const prefix = value.startsWith("-") ? "" : "+";
  return `${prefix}${formatUsdc(value)} USDC`;
}

export function buildApprovalDrilldownTokens(item: ReconciliationApprovalItem): DrilldownToken[] {
  const tokens: DrilldownToken[] = [];
  if (item.ownerAddress) {
    tokens.push({ kind: "ownerAddress", label: "Owner", value: item.ownerAddress });
  }
  if (item.requestId) {
    tokens.push({ kind: "requestId", label: "Request ID", value: item.requestId });
  }
  if (item.txHash) {
    tokens.push({ kind: "txHash", label: "Tx Hash", value: item.txHash });
  }
  return tokens;
}

export function buildWithdrawReviewDrilldownTokens(item: ProviderWithdrawReviewItem): DrilldownToken[] {
  const tokens: DrilldownToken[] = [{ kind: "ownerAddress", label: "Owner", value: item.ownerAddress }];
  if (item.requestId) {
    tokens.push({ kind: "requestId", label: "Request ID", value: item.requestId });
  }
  if (item.txHash) {
    tokens.push({ kind: "txHash", label: "Tx Hash", value: item.txHash });
  }
  return tokens;
}

export function buildReconciliationBreakdownCards(detail: ReconciliationDetail): ReconciliationBreakdownCard[] {
  return [
    {
      label: "Platform income",
      value: `${formatUsdc(detail.platformFeeBalanceUsdc)} USDC`,
      description: "平台手续费收入池余额，用来反映当前已沉淀的平台收入。",
    },
    {
      label: "Chain vault",
      value: detail.chainVaultUsdc ? `${formatUsdc(detail.chainVaultUsdc)} USDC` : "n/a",
      description: "链上 router/vault 当前真实 USDC 余额。",
    },
    {
      label: "Ledger obligation",
      value: detail.ledgerObligationUsdc ? `${formatUsdc(detail.ledgerObligationUsdc)} USDC` : "n/a",
      description: "平台账本对 owner 的当前义务总额。",
    },
    {
      label: "Absolute delta",
      value: `${formatUsdc(detail.reconciliationDeltaUsdc)} USDC`,
      description: "后端稳定读模型中的绝对偏差值，也是首页哨兵卡展示的数据。",
    },
    {
      label: "Signed difference",
      value: formatSignedUsdc(detail.signedDifferenceUsdc),
      description: "按 chain vault - ledger obligation 计算，帮助判断是 vault surplus 还是 vault deficit。",
    },
  ];
}

export function buildReconciliationQueueCards(detail: ReconciliationDetail): ReconciliationQueueCard[] {
  return [
    {
      label: "Pending approvals",
      value: String(detail.pendingApprovals),
      description: "仍待 review 或执行的审批任务，可能拖慢异常处置。",
    },
    {
      label: "Deposit exceptions",
      value: String(detail.depositExceptions),
      description: "充值异常积压通常是对账偏差的第一关联信号。",
    },
    {
      label: "Pending withdrawals",
      value: String(detail.pendingWithdrawalCount),
      description: "出账排队会影响 vault 余额波动和 operator 判断顺序。",
    },
    {
      label: "Audit alerts",
      value: String(detail.auditAlerts),
      description: "若同时存在敏感操作告警，需提高对账异常处置优先级。",
    },
  ];
}

export function resolveReconciliationStamp(detail: ReconciliationDetail): string {
  return detail.projectedAt ? formatDateTime(detail.projectedAt) : "projection pending";
}

export function resolveDrilldownTitle(result: ReconciliationDrilldownResult): string {
  if (result.ownerAddress) {
    return `Owner ${result.ownerAddress}`;
  }
  if (result.requestId) {
    return `Request ID ${result.requestId}`;
  }
  if (result.txHash) {
    return `Tx Hash ${result.txHash}`;
  }
  return "Cross locator";
}

export function resolveDrilldownCount(result: ReconciliationDrilldownResult): number {
  return result.priorityApprovals.length + result.depositRepairApprovals.length + result.pendingWithdrawalReviews.length;
}