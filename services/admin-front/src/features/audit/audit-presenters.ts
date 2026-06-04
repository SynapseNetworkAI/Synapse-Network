import type { AuditActionItem } from "@/services/admin-api";

export function getAuditResultTone(
  resultStatus: string
): "green" | "orange" | "red" | "gray" {
  return resultStatus === "success" ? "green" : "red";
}

export function filterAuditItems(
  items: AuditActionItem[],
  search: string,
  statusFilter: string
): AuditActionItem[] {
  const normalizedSearch = search.trim().toLowerCase();

  return items.filter((item) => {
    const haystack = [
      item.actionType,
      item.operatorEmail,
      item.operatorRole,
      item.resourceType,
      item.resourceId,
      item.approvalId,
      item.jobId,
      item.errorCode,
    ]
      .join(" ")
      .toLowerCase();

    const matchesSearch =
      !normalizedSearch || haystack.includes(normalizedSearch);
    const matchesStatus =
      statusFilter === "all" || item.resultStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });
}

export function buildAuditMetrics(items: AuditActionItem[]) {
  const failed = items.filter((item) => item.resultStatus !== "success").length;
  const success = items.filter(
    (item) => item.resultStatus === "success"
  ).length;
  const approvalLinked = items.filter((item) =>
    Boolean(item.approvalId)
  ).length;
  const executionLinked = items.filter((item) => Boolean(item.jobId)).length;

  return {
    total: items.length,
    failed,
    success,
    approvalLinked,
    executionLinked,
  };
}

export function collectAuditStatuses(items: AuditActionItem[]): string[] {
  return [...new Set(items.map((item) => item.resultStatus))];
}

export function topAuditErrorCodes(items: AuditActionItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.errorCode) {
      continue;
    }
    counts.set(item.errorCode, (counts.get(item.errorCode) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([errorCode, count]) => ({ errorCode, count }));
}

export function sortAuditItems(items: AuditActionItem[]): AuditActionItem[] {
  return [...items].sort((left, right) => {
    const leftTime = left.createdAt ?? "";
    const rightTime = right.createdAt ?? "";
    return rightTime.localeCompare(leftTime);
  });
}
