import type { ApprovalItem } from "@/services/admin-api";

const approvalTypeLabels: Record<string, string> = {
  provider_withdraw_review: "Provider 提现人工审核",
  withdrawal_approve: "提现执行审批",
  refund_approve: "退款审批",
  deposit_repair: "充值修复审批",
};

const approvalStatusLabels: Record<string, string> = {
  SUBMITTED: "待分派",
  UNDER_REVIEW: "审核中",
  APPROVED_PENDING_EXECUTION: "待执行",
  REJECTED: "已拒绝",
  EXECUTED: "已执行",
};

const approvalLevelTones: Record<string, "green" | "orange" | "red" | "gray"> = {
  L1: "gray",
  L2: "orange",
  L3: "red",
};

export function getApprovalTypeLabel(approvalType: string): string {
  return approvalTypeLabels[approvalType] ?? approvalType;
}

export function getApprovalStatusLabel(status: string): string {
  return approvalStatusLabels[status] ?? status;
}

export function getApprovalLevelTone(level: string): "green" | "orange" | "red" | "gray" {
  return approvalLevelTones[level] ?? "gray";
}

export function buildApprovalMetrics(items: ApprovalItem[]) {
  const projectedWithdrawReviews = items.filter((item) => item.approvalType === "provider_withdraw_review");
  const l3Count = items.filter((item) => item.approvalLevel === "L3").length;
  const awaitingReviewCount = items.filter((item) => item.status === "SUBMITTED" || item.status === "UNDER_REVIEW").length;
  const pendingExecutionCount = items.filter((item) => item.status === "APPROVED_PENDING_EXECUTION").length;
  const projectedWithdrawAmount = projectedWithdrawReviews
    .reduce((sum, item) => sum + Number(item.amountUsdc || 0), 0);

  return {
    total: items.length,
    l3Count,
    awaitingReviewCount,
    pendingExecutionCount,
    projectedWithdrawCount: projectedWithdrawReviews.length,
    projectedWithdrawAmount,
  };
}

export function filterApprovals(items: ApprovalItem[], search: string, typeFilter: string, statusFilter: string): ApprovalItem[] {
  const normalizedSearch = search.trim().toLowerCase();

  return items.filter((item) => {
    const matchesSearch = !normalizedSearch
      || item.approvalId.toLowerCase().includes(normalizedSearch)
      || item.approvalType.toLowerCase().includes(normalizedSearch)
      || item.requesterRole.toLowerCase().includes(normalizedSearch)
      || item.approvalLevel.toLowerCase().includes(normalizedSearch);

    const matchesType = typeFilter === "all" || item.approvalType === typeFilter;
    const matchesStatus = statusFilter === "all" || item.status === statusFilter;

    return matchesSearch && matchesType && matchesStatus;
  });
}

function priorityWeight(item: ApprovalItem): number {
  let score = 0;

  if (item.approvalLevel === "L3") {
    score += 100;
  } else if (item.approvalLevel === "L2") {
    score += 60;
  } else {
    score += 30;
  }

  if (item.status === "UNDER_REVIEW") {
    score += 30;
  } else if (item.status === "SUBMITTED") {
    score += 20;
  } else if (item.status === "APPROVED_PENDING_EXECUTION") {
    score += 10;
  }

  if (item.approvalType === "provider_withdraw_review") {
    score += 20;
  }

  return score;
}

export function sortApprovalsByPriority(items: ApprovalItem[]): ApprovalItem[] {
  return [...items].sort((left, right) => {
    const weightDifference = priorityWeight(right) - priorityWeight(left);
    if (weightDifference !== 0) {
      return weightDifference;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function listApprovalTypes(items: ApprovalItem[]): string[] {
  return [...new Set(items.map((item) => item.approvalType))];
}
