import { describe, expect, it } from "vitest";

import { buildExecutionFailureClusters, buildExecutionMetrics, buildExecutionTargetCards, filterExecutionJobs, getExecutionStatusLabel, sortExecutionJobsByPriority } from "./execution-presenters";

const jobs = [
  {
    jobId: "job-003",
    approvalId: "appr-003",
    executionType: "refund_execute",
    targetSystem: "gateway",
    status: "SUCCEEDED",
    idempotencyKey: "idem-003",
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    maxRetryCount: 3,
    queuedBy: "finance-admin",
    updatedAt: "2026-03-21T10:00:00Z",
    attempts: [{ attemptNo: 1, status: "SUCCEEDED", errorCode: null, errorSummary: null, finishedAt: "2026-03-21T10:00:00Z" }],
  },
  {
    jobId: "job-001",
    approvalId: "appr-001",
    executionType: "withdrawal_release",
    targetSystem: "gateway",
    status: "FAILED",
    idempotencyKey: "idem-001",
    errorCode: "ADAPTER_TIMEOUT",
    errorMessage: "adapter timeout",
    retryCount: 1,
    maxRetryCount: 3,
    queuedBy: "risk-admin",
    updatedAt: "2026-03-21T12:00:00Z",
    attempts: [{ attemptNo: 1, status: "FAILED", errorCode: "ADAPTER_TIMEOUT", errorSummary: "timeout", finishedAt: "2026-03-21T12:00:00Z" }],
  },
  {
    jobId: "job-002",
    approvalId: "appr-002",
    executionType: "deposit_repair",
    targetSystem: "gateway-admin",
    status: "FAILED",
    idempotencyKey: "idem-002",
    errorCode: "ADAPTER_TIMEOUT",
    errorMessage: "timeout again",
    retryCount: 3,
    maxRetryCount: 3,
    queuedBy: "ops-admin",
    updatedAt: "2026-03-21T11:00:00Z",
    attempts: [{ attemptNo: 3, status: "FAILED", errorCode: "ADAPTER_TIMEOUT", errorSummary: "timeout", finishedAt: "2026-03-21T11:00:00Z" }],
  },
  {
    jobId: "job-004",
    approvalId: "appr-004",
    executionType: "fee_policy_apply",
    targetSystem: "config-service",
    status: "EXECUTING",
    idempotencyKey: "idem-004",
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    maxRetryCount: 2,
    queuedBy: "ops-admin",
    updatedAt: "2026-03-21T12:30:00Z",
    attempts: [],
  },
];

describe("execution-presenters", () => {
  it("builds execution metrics", () => {
    expect(buildExecutionMetrics(jobs)).toEqual({
      totalCount: 4,
      failedCount: 2,
      retryableCount: 1,
      exhaustedCount: 1,
      inflightCount: 1,
      succeededCount: 1,
    });
  });

  it("filters by search, status, and target", () => {
    expect(filterExecutionJobs(jobs, "withdrawal", "FAILED", "gateway").map((item) => item.jobId)).toEqual(["job-001"]);
  });

  it("sorts retryable failures ahead of exhausted and successful jobs", () => {
    expect(sortExecutionJobsByPriority(jobs).map((item) => item.jobId)).toEqual(["job-001", "job-002", "job-004", "job-003"]);
  });

  it("clusters failed jobs by error code", () => {
    expect(buildExecutionFailureClusters(jobs)).toEqual([
      { code: "ADAPTER_TIMEOUT", count: 2, jobIds: ["job-001", "job-002"] },
    ]);
  });

  it("builds target cards and status labels", () => {
    expect(buildExecutionTargetCards(jobs)).toEqual([
      { key: "gateway", label: "gateway", totalCount: 2, failedCount: 1, inflightCount: 0 },
      { key: "config-service", label: "config-service", totalCount: 1, failedCount: 0, inflightCount: 1 },
      { key: "gateway-admin", label: "gateway-admin", totalCount: 1, failedCount: 1, inflightCount: 0 },
    ]);
    expect(getExecutionStatusLabel("FAILED")).toBe("执行失败");
  });
});