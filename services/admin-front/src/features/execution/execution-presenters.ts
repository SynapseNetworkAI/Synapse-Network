import {
  EXECUTION_JOB_STATUS,
  executionJobStatusLabel,
  executionJobStatusTone,
  isExecutionJobTerminalStatus,
  type ExecutionJobStatus,
  type StatusTone,
} from "@/domain/status";
import type { ExecutionJobItem } from "@/services/admin-api";

function isFailed(job: ExecutionJobItem): boolean {
  return job.status === EXECUTION_JOB_STATUS.FAILED;
}

function isSucceeded(job: ExecutionJobItem): boolean {
  return job.status === EXECUTION_JOB_STATUS.SUCCEEDED;
}

function isInflight(job: ExecutionJobItem): boolean {
  return !isExecutionJobTerminalStatus(job.status);
}

function isRetryable(job: ExecutionJobItem): boolean {
  return isFailed(job) && job.retryCount < job.maxRetryCount;
}

function isExhausted(job: ExecutionJobItem): boolean {
  return isFailed(job) && job.retryCount >= job.maxRetryCount;
}

function priorityWeight(job: ExecutionJobItem): number {
  let score = 0;

  if (isRetryable(job)) {
    score += 160;
  } else if (isExhausted(job)) {
    score += 130;
  } else if (isInflight(job)) {
    score += 90;
  } else {
    score += 30;
  }

  score += Math.min(job.retryCount, 5) * 6;

  if (job.errorCode) {
    score += 10;
  }

  return score;
}

export function getExecutionStatusLabel(status: ExecutionJobStatus): string {
  return executionJobStatusLabel(status);
}

export function getExecutionTone(status: ExecutionJobStatus): StatusTone {
  return executionJobStatusTone(status);
}

export function isExecutionJobRetryable(job: ExecutionJobItem): boolean {
  return isRetryable(job);
}

export function getExecutionRetryActionLabel({
  isRetrying,
  retryable,
}: Readonly<{ isRetrying: boolean; retryable: boolean }>): string {
  if (isRetrying) {
    return "处理中...";
  }
  return retryable ? "Retry" : "Locked";
}

export function getExecutionTargetCardTone({
  failedCount,
  inflightCount,
}: Readonly<{ failedCount: number; inflightCount: number }>): StatusTone {
  if (failedCount > 0) {
    return "red";
  }
  return inflightCount > 0 ? "orange" : "green";
}

export function buildExecutionMetrics(items: ExecutionJobItem[]) {
  const failedCount = items.filter(isFailed).length;
  const retryableCount = items.filter(isRetryable).length;
  const exhaustedCount = items.filter(isExhausted).length;
  const inflightCount = items.filter(isInflight).length;
  const succeededCount = items.filter(isSucceeded).length;

  return {
    totalCount: items.length,
    failedCount,
    retryableCount,
    exhaustedCount,
    inflightCount,
    succeededCount,
  };
}

export function filterExecutionJobs(
  items: ExecutionJobItem[],
  search: string,
  statusFilter: string,
  targetFilter: string
): ExecutionJobItem[] {
  const normalizedSearch = search.trim().toLowerCase();

  return items.filter((job) => {
    const matchesSearch =
      !normalizedSearch ||
      job.jobId.toLowerCase().includes(normalizedSearch) ||
      job.approvalId.toLowerCase().includes(normalizedSearch) ||
      job.executionType.toLowerCase().includes(normalizedSearch) ||
      job.targetSystem.toLowerCase().includes(normalizedSearch) ||
      (job.errorCode ?? "").toLowerCase().includes(normalizedSearch);

    const matchesStatus = statusFilter === "all" || job.status === statusFilter;
    const matchesTarget =
      targetFilter === "all" || job.targetSystem === targetFilter;

    return matchesSearch && matchesStatus && matchesTarget;
  });
}

export function sortExecutionJobsByPriority(
  items: ExecutionJobItem[]
): ExecutionJobItem[] {
  return [...items].sort((left, right) => {
    const weightDifference = priorityWeight(right) - priorityWeight(left);
    if (weightDifference !== 0) {
      return weightDifference;
    }
    return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
  });
}

export function buildExecutionFailureClusters(items: ExecutionJobItem[]) {
  const buckets = new Map<
    string,
    { code: string; count: number; jobIds: string[] }
  >();

  items.forEach((job) => {
    if (!isFailed(job)) {
      return;
    }
    const code =
      job.errorCode ??
      job.attempts.find((attempt) => attempt.errorCode)?.errorCode ??
      "unknown";
    const bucket = buckets.get(code);
    if (bucket) {
      bucket.count += 1;
      bucket.jobIds.push(job.jobId);
      return;
    }
    buckets.set(code, {
      code,
      count: 1,
      jobIds: [job.jobId],
    });
  });

  return [...buckets.values()].sort(
    (left, right) =>
      right.count - left.count || left.code.localeCompare(right.code)
  );
}

export function buildExecutionTargetCards(items: ExecutionJobItem[]) {
  const buckets = new Map<
    string,
    {
      key: string;
      label: string;
      totalCount: number;
      failedCount: number;
      inflightCount: number;
    }
  >();

  items.forEach((job) => {
    const key = job.targetSystem;
    const bucket = buckets.get(key) ?? {
      key: key.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
      label: key,
      totalCount: 0,
      failedCount: 0,
      inflightCount: 0,
    };

    bucket.totalCount += 1;
    if (isFailed(job)) {
      bucket.failedCount += 1;
    }
    if (isInflight(job)) {
      bucket.inflightCount += 1;
    }

    buckets.set(key, bucket);
  });

  return [...buckets.values()].sort(
    (left, right) =>
      right.totalCount - left.totalCount ||
      left.label.localeCompare(right.label)
  );
}

export function listExecutionTargets(items: ExecutionJobItem[]): string[] {
  return [...new Set(items.map((job) => job.targetSystem))];
}
