import type { ApprovalItem } from "@/services/admin-api";

const riskTypes = ["risk", "withdraw", "refund", "deposit", "provider_withdraw_review"];

export function filterRiskApprovals(items: ApprovalItem[]): ApprovalItem[] {
  return items.filter((item) => {
    const normalizedType = item.approvalType.toLowerCase();
    return riskTypes.some((value) => normalizedType.includes(value)) || item.approvalLevel === "L2" || item.approvalLevel === "L3";
  });
}

export function buildRiskMetrics(items: ApprovalItem[]) {
  const red = items.filter((item) => item.approvalLevel === "L3").length;
  const yellow = items.filter((item) => item.approvalLevel === "L2").length;
  const underReview = items.filter((item) => item.status === "UNDER_REVIEW").length;
  const submitted = items.filter((item) => item.status === "SUBMITTED").length;

  return {
    total: items.length,
    red,
    yellow,
    underReview,
    submitted,
  };
}

export function filterVisibleRiskItems(items: ApprovalItem[], search: string, levelFilter: string): ApprovalItem[] {
  const normalizedSearch = search.trim().toLowerCase();

  return items.filter((item) => {
    const matchesSearch = !normalizedSearch
      || item.approvalId.toLowerCase().includes(normalizedSearch)
      || item.approvalType.toLowerCase().includes(normalizedSearch)
      || item.requesterRole.toLowerCase().includes(normalizedSearch);
    const matchesLevel = levelFilter === "all" || item.approvalLevel === levelFilter;
    return matchesSearch && matchesLevel;
  });
}

export function sortRiskItems(items: ApprovalItem[]): ApprovalItem[] {
  const weight = (item: ApprovalItem) => {
    if (item.approvalLevel === "L3") {
      return 100;
    }
    if (item.approvalLevel === "L2") {
      return 70;
    }
    return 40;
  };

  return [...items].sort((left, right) => {
    const weightDifference = weight(right) - weight(left);
    if (weightDifference !== 0) {
      return weightDifference;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}
