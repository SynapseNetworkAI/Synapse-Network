import {
  riskLevelLabel,
  riskLevelTone,
  withdrawalStatusLabel,
  withdrawalStatusTone,
  type RiskLevel,
  type StatusTone,
  type WithdrawalStatus,
} from "@/domain/status";
import type { ProviderWithdrawReviewItem } from "@/services/admin-api";

function priorityWeight(item: ProviderWithdrawReviewItem): number {
  let score = 0;

  if (item.riskLevel === "red") {
    score += 120;
  } else if (item.riskLevel === "yellow") {
    score += 80;
  } else {
    score += 40;
  }

  if (!item.evidenceSummary) {
    score += 10;
  }

  if (!item.txHash) {
    score += 8;
  }

  return score;
}

export function getWithdrawRiskTone(level: RiskLevel | null | undefined): StatusTone {
  return level ? riskLevelTone(level) : "gray";
}

export function getWithdrawRiskLabel(level: RiskLevel | null | undefined): string {
  return level ? riskLevelLabel(level) : "UNKNOWN";
}

export function getWithdrawalStatusTone(status: WithdrawalStatus): StatusTone {
  return withdrawalStatusTone(status);
}

export function getWithdrawalStatusLabel(status: WithdrawalStatus): string {
  return withdrawalStatusLabel(status);
}

export function buildWithdrawReviewMetrics(items: ProviderWithdrawReviewItem[]) {
  const totalAmount = items.reduce((sum, item) => sum + Number(item.amountUsdc || 0), 0);

  return {
    pendingCount: items.length,
    totalAmount,
    redCount: items.filter((item) => item.riskLevel === "red").length,
    yellowCount: items.filter((item) => item.riskLevel === "yellow").length,
    linkedCount: items.filter((item) => Boolean(item.txHash)).length,
  };
}

export function filterWithdrawReviews(items: ProviderWithdrawReviewItem[], search: string, riskFilter: string): ProviderWithdrawReviewItem[] {
  const normalizedSearch = search.trim().toLowerCase();

  return items.filter((item) => {
    const matchesSearch = !normalizedSearch
      || item.withdrawalId.toLowerCase().includes(normalizedSearch)
      || item.ownerAddress.toLowerCase().includes(normalizedSearch)
      || (item.requestId ?? "").toLowerCase().includes(normalizedSearch)
      || (item.riskReasonCode ?? "").toLowerCase().includes(normalizedSearch)
      || (item.txHash ?? "").toLowerCase().includes(normalizedSearch);

    const matchesRisk = riskFilter === "all" || item.riskLevel === riskFilter;

    return matchesSearch && matchesRisk;
  });
}

export function sortWithdrawReviewsByPriority(items: ProviderWithdrawReviewItem[]): ProviderWithdrawReviewItem[] {
  return [...items].sort((left, right) => {
    const weightDifference = priorityWeight(right) - priorityWeight(left);
    if (weightDifference !== 0) {
      return weightDifference;
    }
    return (right.createdAt ?? "").localeCompare(left.createdAt ?? "");
  });
}

export function buildWithdrawReasonClusters(items: ProviderWithdrawReviewItem[]) {
  const buckets = new Map<string, { code: string; count: number }>();

  items.forEach((item) => {
    const code = item.riskReasonCode ?? "manual_review";
    const bucket = buckets.get(code);
    if (bucket) {
      bucket.count += 1;
      return;
    }
    buckets.set(code, { code, count: 1 });
  });

  return [...buckets.values()].sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

export function listWithdrawRiskLevels(items: ProviderWithdrawReviewItem[]): RiskLevel[] {
  return [...new Set(items.map((item) => item.riskLevel).filter((value): value is RiskLevel => value !== null))];
}

export function paginateWithdrawReviews(items: ProviderWithdrawReviewItem[], page: number, pageSize: number): ProviderWithdrawReviewItem[] {
  if (pageSize <= 0) {
    return items;
  }

  const normalizedPage = Math.max(1, page);
  const startIndex = (normalizedPage - 1) * pageSize;
  return items.slice(startIndex, startIndex + pageSize);
}
