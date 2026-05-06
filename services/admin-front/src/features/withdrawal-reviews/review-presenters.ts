import {
  riskLevelLabel,
  riskLevelTone,
  withdrawalStatusLabel,
  withdrawalStatusTone,
  type RiskLevel,
  type StatusTone,
  type WithdrawalStatus,
} from "@/domain/status";
import { parseMoneyStringForChart } from "@/lib/admin-console";
import type { ProviderWithdrawReviewItem } from "@/services/admin-api";

export function getWithdrawRiskTone(
  level: RiskLevel | null | undefined
): StatusTone {
  return level ? riskLevelTone(level) : "gray";
}

export function getWithdrawRiskLabel(
  level: RiskLevel | null | undefined
): string {
  return level ? riskLevelLabel(level) : "UNKNOWN";
}

export function getWithdrawalStatusTone(status: WithdrawalStatus): StatusTone {
  return withdrawalStatusTone(status);
}

export function getWithdrawalStatusLabel(status: WithdrawalStatus): string {
  return withdrawalStatusLabel(status);
}

export function getWithdrawReviewKindLabel(
  item: ProviderWithdrawReviewItem
): string {
  return item.withdrawalKind === "consumer_refund"
    ? "Consumer withdrawal"
    : "Provider withdrawal";
}

export function getWithdrawReviewKindTone(
  item: ProviderWithdrawReviewItem
): StatusTone {
  return item.withdrawalKind === "consumer_refund" ? "orange" : "gray";
}

export function buildWithdrawReviewMetrics(
  items: ProviderWithdrawReviewItem[]
) {
  const totalAmount = items.reduce(
    (sum, item) => sum + parseMoneyStringForChart(item.amountUsdc || "0"),
    0
  );

  return {
    pendingCount: items.length,
    totalAmount,
    redCount: items.filter((item) => item.riskLevel === "red").length,
    yellowCount: items.filter((item) => item.riskLevel === "yellow").length,
    linkedCount: items.filter((item) => Boolean(item.txHash)).length,
  };
}

function withdrawReviewMatchesSearch(
  item: ProviderWithdrawReviewItem,
  normalizedSearch: string
): boolean {
  if (!normalizedSearch) {
    return true;
  }
  return [
    item.withdrawalId,
    item.ownerAddress,
    item.requestId,
    item.riskReasonCode,
    item.txHash,
  ].some((value) => (value ?? "").toLowerCase().includes(normalizedSearch));
}

function withdrawReviewMatchesRisk(
  item: ProviderWithdrawReviewItem,
  riskFilter: string
): boolean {
  return riskFilter === "all" || item.riskLevel === riskFilter;
}

export function filterWithdrawReviews(
  items: ProviderWithdrawReviewItem[],
  search: string,
  riskFilter: string
): ProviderWithdrawReviewItem[] {
  const normalizedSearch = search.trim().toLowerCase();

  return items.filter((item) => {
    return (
      withdrawReviewMatchesSearch(item, normalizedSearch) &&
      withdrawReviewMatchesRisk(item, riskFilter)
    );
  });
}

export function buildWithdrawReasonClusters(
  items: ProviderWithdrawReviewItem[]
) {
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

  return [...buckets.values()].sort(
    (left, right) =>
      right.count - left.count || left.code.localeCompare(right.code)
  );
}

export function listWithdrawRiskLevels(
  items: ProviderWithdrawReviewItem[]
): RiskLevel[] {
  return [
    ...new Set(
      items
        .map((item) => item.riskLevel)
        .filter((value): value is RiskLevel => value !== null)
    ),
  ];
}

export function paginateWithdrawReviews(
  items: ProviderWithdrawReviewItem[],
  page: number,
  pageSize: number
): ProviderWithdrawReviewItem[] {
  if (pageSize <= 0) {
    return items;
  }

  const normalizedPage = Math.max(1, page);
  const startIndex = (normalizedPage - 1) * pageSize;
  return items.slice(startIndex, startIndex + pageSize);
}
