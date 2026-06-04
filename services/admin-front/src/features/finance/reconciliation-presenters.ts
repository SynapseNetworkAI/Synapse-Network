import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import {
  getFinanceMetricGlossary,
  getFinanceQueueGlossary,
} from "@/features/finance/finance-glossary";
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

type ReconciliationMetricSurfaceCard = {
  key: string;
  label: string;
  value: string;
  description: string;
  hint: string;
  meta: string;
  pending?: boolean;
};

function formatSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = seconds % 60;
  return `${minutes}m ${String(remainderSeconds).padStart(2, "0")}s`;
}

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

export function resolveReconciliationTone(
  detail: ReconciliationDetail
): "green" | "orange" | "red" {
  if (detail.reconciliationAlert) {
    return "red";
  }
  if (detail.imbalanceDirection !== "balanced") {
    return "orange";
  }
  return "green";
}

export function formatSignedUsdc(value: string | null): string {
  if (!value) {
    return "n/a";
  }

  const prefix = value.startsWith("-") ? "" : "+";
  return `${prefix}${formatUsdc(value)} USDC`;
}

export function buildApprovalDrilldownTokens(
  item: ReconciliationApprovalItem
): DrilldownToken[] {
  const tokens: DrilldownToken[] = [];
  if (item.ownerAddress) {
    tokens.push({
      kind: "ownerAddress",
      label: "Owner",
      value: item.ownerAddress,
    });
  }
  if (item.requestId) {
    tokens.push({
      kind: "requestId",
      label: "Request ID",
      value: item.requestId,
    });
  }
  if (item.txHash) {
    tokens.push({ kind: "txHash", label: "Tx Hash", value: item.txHash });
  }
  return tokens;
}

export function buildWithdrawReviewDrilldownTokens(
  item: ProviderWithdrawReviewItem
): DrilldownToken[] {
  const tokens: DrilldownToken[] = [
    { kind: "ownerAddress", label: "Owner", value: item.ownerAddress },
  ];
  if (item.requestId) {
    tokens.push({
      kind: "requestId",
      label: "Request ID",
      value: item.requestId,
    });
  }
  if (item.txHash) {
    tokens.push({ kind: "txHash", label: "Tx Hash", value: item.txHash });
  }
  return tokens;
}

export function buildReconciliationBreakdownCards(
  detail: ReconciliationDetail
): ReconciliationBreakdownCard[] {
  return [
    {
      label: getFinanceMetricGlossary("platformIncome").label,
      value: `${formatUsdc(detail.platformFeeBalanceUsdc)} USDC`,
      description: getFinanceMetricGlossary("platformIncome").hint,
    },
    {
      label: getFinanceMetricGlossary("chainVault").label,
      value: detail.chainVaultUsdc
        ? `${formatUsdc(detail.chainVaultUsdc)} USDC`
        : "n/a",
      description: getFinanceMetricGlossary("chainVault").hint,
    },
    {
      label: getFinanceMetricGlossary("ledgerObligation").label,
      value: detail.ledgerObligationUsdc
        ? `${formatUsdc(detail.ledgerObligationUsdc)} USDC`
        : "n/a",
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

export function buildReconciliationHeroCards(
  detail: ReconciliationDetail
): ReconciliationMetricSurfaceCard[] {
  return [
    {
      key: "chain-vault",
      label: getFinanceMetricGlossary("chainVault").label,
      value: detail.chainVaultUsdc
        ? `${formatUsdc(detail.chainVaultUsdc)} USDC`
        : "n/a",
      description: getFinanceMetricGlossary("chainVault").hint,
      hint: getFinanceMetricGlossary("chainVault").hint,
      meta: getFinanceMetricGlossary("chainVault").meta,
    },
    {
      key: "ledger-obligation",
      label: getFinanceMetricGlossary("ledgerObligation").label,
      value: detail.ledgerObligationUsdc
        ? `${formatUsdc(detail.ledgerObligationUsdc)} USDC`
        : "n/a",
      description: getFinanceMetricGlossary("ledgerObligation").hint,
      hint: getFinanceMetricGlossary("ledgerObligation").hint,
      meta: getFinanceMetricGlossary("ledgerObligation").meta,
    },
    {
      key: "signed-difference",
      label: getFinanceMetricGlossary("signedDifference").label,
      value: formatSignedUsdc(detail.signedDifferenceUsdc),
      description: getFinanceMetricGlossary("signedDifference").hint,
      hint: getFinanceMetricGlossary("signedDifference").hint,
      meta: getFinanceMetricGlossary("signedDifference").meta,
    },
    {
      key: "absolute-delta",
      label: getFinanceMetricGlossary("absoluteDelta").label,
      value: `${formatUsdc(detail.reconciliationDeltaUsdc)} USDC`,
      description: getFinanceMetricGlossary("absoluteDelta").hint,
      hint: getFinanceMetricGlossary("absoluteDelta").hint,
      meta: getFinanceMetricGlossary("absoluteDelta").meta,
    },
  ];
}

export function buildReconciliationSupportingCards(
  detail: ReconciliationDetail
): ReconciliationMetricSurfaceCard[] {
  return [
    {
      key: "owner-liability",
      label: getFinanceMetricGlossary("ownerLiability").label,
      value: `${formatUsdc(detail.ownerLiabilityUsdc)} USDC`,
      description: getFinanceMetricGlossary("ownerLiability").hint,
      hint: getFinanceMetricGlossary("ownerLiability").hint,
      meta: getFinanceMetricGlossary("ownerLiability").meta,
    },
    {
      key: "provider-payable",
      label: getFinanceMetricGlossary("providerPayable").label,
      value: `${formatUsdc(detail.providerPayableUsdc)} USDC`,
      description: getFinanceMetricGlossary("providerPayable").hint,
      hint: getFinanceMetricGlossary("providerPayable").hint,
      meta: getFinanceMetricGlossary("providerPayable").meta,
    },
    {
      key: "platform-income",
      label: getFinanceMetricGlossary("platformIncome").label,
      value: `${formatUsdc(detail.platformFeeBalanceUsdc)} USDC`,
      description: getFinanceMetricGlossary("platformIncome").hint,
      hint: getFinanceMetricGlossary("platformIncome").hint,
      meta: getFinanceMetricGlossary("platformIncome").meta,
    },
  ];
}

export function buildReconciliationDepositEvidenceCards(
  detail: ReconciliationDetail
): ReconciliationMetricSurfaceCard[] {
  return [
    {
      key: "pending-deposits",
      label: getFinanceMetricGlossary("pendingDeposits").label,
      value: String(detail.pendingDepositCount),
      description: getFinanceMetricGlossary("pendingDeposits").hint,
      hint: getFinanceMetricGlossary("pendingDeposits").hint,
      meta: getFinanceMetricGlossary("pendingDeposits").meta,
    },
    {
      key: "deposit-exceptions",
      label: getFinanceQueueGlossary("depositExceptions").label,
      value: String(detail.depositExceptions),
      description: getFinanceQueueGlossary("depositExceptions").description,
      hint: getFinanceQueueGlossary("depositExceptions").description,
      meta: getFinanceQueueGlossary("depositExceptions").description,
    },
    {
      key: "chain-confirmed-not-ledger-confirmed",
      label: getFinanceMetricGlossary("chainConfirmedNotLedgerConfirmed").label,
      value: String(detail.chainConfirmedNotLedgerConfirmedCount),
      description:
        "链上 receipt 已确认，但账本仍未完成 confirmed 入账的充值数量。",
      hint: getFinanceMetricGlossary("chainConfirmedNotLedgerConfirmed").hint,
      meta: getFinanceMetricGlossary("chainConfirmedNotLedgerConfirmed").meta,
      pending: false,
    },
    {
      key: "deposit-p95-sync-delay",
      label: getFinanceMetricGlossary("depositP95SyncDelay").label,
      value: formatSeconds(detail.depositP95SyncDelaySeconds),
      description:
        "从 receipt confirmed 到账本 confirmed 的充值同步 P95 时延。",
      hint: getFinanceMetricGlossary("depositP95SyncDelay").hint,
      meta: getFinanceMetricGlossary("depositP95SyncDelay").meta,
      pending: false,
    },
  ];
}

export function buildReconciliationOutflowEvidenceCards(
  detail: ReconciliationDetail
): ReconciliationMetricSurfaceCard[] {
  return [
    {
      key: "today-refund",
      label: getFinanceMetricGlossary("todayRefund").label,
      value: `${formatUsdc(detail.todayRefundUsdc)} USDC`,
      description:
        "今日已完成退款金额，用于判断链上余额下降是否来自 consumer refund。",
      hint: getFinanceMetricGlossary("todayRefund").hint,
      meta: getFinanceMetricGlossary("todayRefund").meta,
      pending: false,
    },
    {
      key: "today-withdrawal",
      label: getFinanceMetricGlossary("todayWithdrawal").label,
      value: `${formatUsdc(detail.todayWithdrawalUsdc)} USDC`,
      description:
        "今日已完成 provider withdrawal 金额，用于判断偏差是否来自出账链路。",
      hint: getFinanceMetricGlossary("todayWithdrawal").hint,
      meta: getFinanceMetricGlossary("todayWithdrawal").meta,
      pending: false,
    },
    {
      key: "pending-withdrawals",
      label: getFinanceMetricGlossary("pendingWithdrawals").label,
      value: String(detail.pendingWithdrawalCount),
      description: getFinanceMetricGlossary("pendingWithdrawals").hint,
      hint: getFinanceMetricGlossary("pendingWithdrawals").hint,
      meta: getFinanceMetricGlossary("pendingWithdrawals").meta,
    },
    {
      key: "recently-completed-outflows",
      label: getFinanceMetricGlossary("recentlyCompletedOutflows").label,
      value: `${formatUsdc(detail.recentlyCompletedOutflowsUsdc)} USDC`,
      description:
        "最近 6 小时已完成 refund / withdrawal 的聚合金额，用来解释链上余额短时下降。",
      hint: getFinanceMetricGlossary("recentlyCompletedOutflows").hint,
      meta: getFinanceMetricGlossary("recentlyCompletedOutflows").meta,
      pending: false,
    },
  ];
}

export function buildReconciliationQueueCards(
  detail: ReconciliationDetail
): ReconciliationQueueCard[] {
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
      description: getFinanceQueueGlossary("queuePendingWithdrawals")
        .description,
    },
    {
      label: getFinanceQueueGlossary("auditAlerts").label,
      value: String(detail.auditAlerts),
      description: getFinanceQueueGlossary("auditAlerts").description,
    },
  ];
}

export function resolveReconciliationStamp(
  detail: ReconciliationDetail
): string {
  return detail.projectedAt
    ? formatDateTime(detail.projectedAt)
    : "projection pending";
}

export function resolveDrilldownTitle(
  result: ReconciliationDrilldownResult
): string {
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

export function resolveDrilldownCount(
  result: ReconciliationDrilldownResult
): number {
  return (
    result.priorityApprovals.length +
    result.depositRepairApprovals.length +
    result.pendingWithdrawalReviews.length
  );
}
