import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import { getFinanceMetricGlossary, getFinanceQueueGlossary } from "@/features/finance/finance-glossary";
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
      label: getFinanceMetricGlossary("platformIncome").label,
      value: `${formatUsdc(detail.platformFeeBalanceUsdc)} USDC`,
      description: getFinanceMetricGlossary("platformIncome").hint,
    },
    {
      label: getFinanceMetricGlossary("chainVault").label,
      value: detail.chainVaultUsdc ? `${formatUsdc(detail.chainVaultUsdc)} USDC` : "n/a",
      description: getFinanceMetricGlossary("chainVault").hint,
    },
    {
      label: getFinanceMetricGlossary("ledgerObligation").label,
      value: detail.ledgerObligationUsdc ? `${formatUsdc(detail.ledgerObligationUsdc)} USDC` : "n/a",
      description: getFinanceMetricGlossary("ledgerObligation").hint,
    },
    {
      label: getFinanceMetricGlossary("absoluteDelta").label,
      value: `${formatUsdc(detail.reconciliationDeltaUsdc)} USDC`,
      description: getFinanceMetricGlossary("absoluteDelta").hint,
    },
    {
      label: getFinanceMetricGlossary("signedDifference").label,
      value: formatSignedUsdc(detail.signedDifferenceUsdc),
      description: getFinanceMetricGlossary("signedDifference").hint,
    },
  ];
}

export function buildReconciliationQueueCards(detail: ReconciliationDetail): ReconciliationQueueCard[] {
  return [
    {
      label: getFinanceQueueGlossary("pendingApprovals").label,
      value: String(detail.pendingApprovals),
      description: getFinanceQueueGlossary("pendingApprovals").description,
    },
    {
      label: getFinanceQueueGlossary("depositExceptions").label,
      value: String(detail.depositExceptions),
      description: getFinanceQueueGlossary("depositExceptions").description,
    },
    {
      label: getFinanceQueueGlossary("queuePendingWithdrawals").label,
      value: String(detail.pendingWithdrawalCount),
      description: getFinanceQueueGlossary("queuePendingWithdrawals").description,
    },
    {
      label: getFinanceQueueGlossary("auditAlerts").label,
      value: String(detail.auditAlerts),
      description: getFinanceQueueGlossary("auditAlerts").description,
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