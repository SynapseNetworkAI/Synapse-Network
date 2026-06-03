import { describe, expect, it } from "vitest";

import {
  buildAuditMetrics,
  collectAuditStatuses,
  filterAuditItems,
  getAuditResultTone,
  sortAuditItems,
  topAuditErrorCodes,
} from "./audit-presenters";

const items = [
  {
    auditId: 1,
    actionType: "approval.decide",
    resultStatus: "success",
    operatorId: "admin-1",
    operatorEmail: "alpha@synapse.test",
    operatorRole: "reviewer",
    approvalId: "appr-1",
    jobId: null,
    resourceType: "approval",
    resourceId: "appr-1",
    errorCode: null,
    createdAt: "2026-03-21T09:00:00Z",
  },
  {
    auditId: 2,
    actionType: "execution.retry",
    resultStatus: "failed",
    operatorId: "admin-2",
    operatorEmail: "beta@synapse.test",
    operatorRole: "ops",
    approvalId: null,
    jobId: "job-1",
    resourceType: "execution_job",
    resourceId: "job-1",
    errorCode: "QUEUE_TIMEOUT",
    createdAt: "2026-03-21T10:00:00Z",
  },
  {
    auditId: 3,
    actionType: "execution.retry",
    resultStatus: "failed",
    operatorId: "admin-2",
    operatorEmail: "beta@synapse.test",
    operatorRole: "ops",
    approvalId: null,
    jobId: "job-2",
    resourceType: "execution_job",
    resourceId: "job-2",
    errorCode: "QUEUE_TIMEOUT",
    createdAt: "2026-03-21T11:00:00Z",
  },
];

describe("audit-presenters", () => {
  it("filters by search and result status", () => {
    expect(
      filterAuditItems(items, "beta", "failed").map((item) => item.auditId)
    ).toEqual([2, 3]);
  });

  it("builds audit metrics", () => {
    expect(buildAuditMetrics(items)).toEqual({
      total: 3,
      failed: 2,
      success: 1,
      approvalLinked: 1,
      executionLinked: 2,
    });
  });

  it("collects statuses and top error codes", () => {
    expect(collectAuditStatuses(items)).toEqual(["success", "failed"]);
    expect(topAuditErrorCodes(items)).toEqual([
      { errorCode: "QUEUE_TIMEOUT", count: 2 },
    ]);
  });

  it("sorts newest events first", () => {
    expect(sortAuditItems(items).map((item) => item.auditId)).toEqual([
      3, 2, 1,
    ]);
  });

  it("maps result tones", () => {
    expect(getAuditResultTone("success")).toBe("green");
    expect(getAuditResultTone("failed")).toBe("red");
  });
});
