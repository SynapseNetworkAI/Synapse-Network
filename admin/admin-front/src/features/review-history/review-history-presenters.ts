import type { ProviderWithdrawReviewHistoryItem } from "@/services/admin-api";

export type ReviewHistoryFlowStep = {
  key: string;
  label: string;
  detail: string;
  timestamp: string | null;
  tone: "green" | "orange" | "red" | "gray";
};

const currentStatusLabels: Record<string, string> = {
  APPROVED_AUTO: "已放行",
  COMPLETED: "已完成",
  REJECTED: "已拒绝",
  CANCELLED: "已取消 / 已释放",
};

const decisionLabels: Record<string, string> = {
  APPROVE: "放行",
  REJECT: "驳回",
};

export function getReviewHistoryStatusLabel(status: string): string {
  return currentStatusLabels[status] ?? status;
}

export function getReviewHistoryStatusTone(status: string): "green" | "orange" | "red" | "gray" {
  if (status === "COMPLETED" || status === "APPROVED_AUTO") {
    return "green";
  }
  if (status === "REJECTED") {
    return "red";
  }
  if (status === "CANCELLED") {
    return "gray";
  }
  return "orange";
}

export function getReviewDecisionLabel(decision: string): string {
  return decisionLabels[decision] ?? decision;
}

export function getReviewDecisionTone(decision: string): "green" | "red" | "gray" {
  if (decision === "APPROVE") {
    return "green";
  }
  if (decision === "REJECT") {
    return "red";
  }
  return "gray";
}

export function buildReviewHistoryMetrics(items: ProviderWithdrawReviewHistoryItem[]) {
  return {
    total: items.length,
    approved: items.filter((item) => item.reviewDecision === "APPROVE").length,
    completed: items.filter((item) => item.currentStatus === "COMPLETED").length,
    rejected: items.filter((item) => item.currentStatus === "REJECTED").length,
    cancelled: items.filter((item) => item.currentStatus === "CANCELLED").length,
  };
}

export function collectReviewHistoryStatuses(items: ProviderWithdrawReviewHistoryItem[]): string[] {
  return [...new Set(items.map((item) => item.currentStatus))];
}

export function filterReviewHistoryItems(
  items: ProviderWithdrawReviewHistoryItem[],
  search: string,
  statusFilter: string,
  decisionFilter: string,
): ProviderWithdrawReviewHistoryItem[] {
  const normalizedSearch = search.trim().toLowerCase();

  return items.filter((item) => {
    const haystack = [
      item.withdrawalId,
      item.ownerAddress,
      item.requestId,
      item.txHash,
      item.reviewerEmail,
      item.reviewerRole,
      item.reviewerNote,
      item.reviewDecision,
      item.currentStatus,
    ].filter(Boolean).join(" ").toLowerCase();

    const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
    const matchesStatus = statusFilter === "all" || item.currentStatus === statusFilter;
    const matchesDecision = decisionFilter === "all" || item.reviewDecision === decisionFilter;
    return matchesSearch && matchesStatus && matchesDecision;
  });
}

export function sortReviewHistoryItems(items: ProviderWithdrawReviewHistoryItem[]): ProviderWithdrawReviewHistoryItem[] {
  return [...items].sort((left, right) => (right.reviewedAt ?? "").localeCompare(left.reviewedAt ?? ""));
}

export function buildReviewHistoryFlow(item: ProviderWithdrawReviewHistoryItem): ReviewHistoryFlowStep[] {
  const steps: ReviewHistoryFlowStep[] = [
    {
      key: "submitted",
      label: "进入人工审核",
      detail: item.evidenceSummary ?? item.message ?? "系统判定该提现需要 reviewer 介入。",
      timestamp: item.createdAt,
      tone: "orange",
    },
    {
      key: "reviewed",
      label: item.reviewDecision === "APPROVE" ? "已放行" : "已驳回",
      detail: item.reviewerNote ?? "reviewer 已提交处理结论。",
      timestamp: item.reviewedAt,
      tone: getReviewDecisionTone(item.reviewDecision),
    },
  ];

  if (item.currentStatus !== "REJECTED") {
    steps.push({
      key: "current",
      label: getReviewHistoryStatusLabel(item.currentStatus),
      detail: item.message ?? "系统已经写入当前提现状态。",
      timestamp: item.updatedAt,
      tone: getReviewHistoryStatusTone(item.currentStatus),
    });
  }

  return steps;
}