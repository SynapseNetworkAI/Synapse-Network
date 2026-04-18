import { describe, expect, it } from "vitest";

import {
  APPROVAL_STATUS,
  EXECUTION_JOB_STATUS,
  RISK_LEVEL,
  WITHDRAWAL_STATUS,
  approvalStatusTone,
  assertApprovalStatus,
  assertExecutionJobStatus,
  assertRiskLevel,
  assertWithdrawalStatus,
  executionJobStatusTone,
  parseApprovalStatus,
  parseExecutionJobStatus,
  parseRiskLevel,
  parseWithdrawalStatus,
  withdrawalStatusTone,
} from "@/domain/status";

describe("domain status parsers", () => {
  it("parses canonical approval and withdrawal statuses", () => {
    expect(parseApprovalStatus(APPROVAL_STATUS.SUBMITTED)).toBe(APPROVAL_STATUS.SUBMITTED);
    expect(parseWithdrawalStatus(WITHDRAWAL_STATUS.PENDING_MANUAL_REVIEW)).toBe(WITHDRAWAL_STATUS.PENDING_MANUAL_REVIEW);
    expect(parseRiskLevel(RISK_LEVEL.YELLOW)).toBe(RISK_LEVEL.YELLOW);
  });

  it("normalizes legacy execution aliases to canonical execution statuses", () => {
    expect(parseExecutionJobStatus("QUEUED")).toBe(EXECUTION_JOB_STATUS.PENDING);
    expect(parseExecutionJobStatus("EXECUTING")).toBe(EXECUTION_JOB_STATUS.RUNNING);
    expect(parseExecutionJobStatus("RETRYING")).toBe(EXECUTION_JOB_STATUS.RUNNING);
  });

  it("rejects unknown status values", () => {
    expect(parseApprovalStatus("WAITING")).toBeNull();
    expect(() => assertApprovalStatus("WAITING")).toThrow("Unknown approval status");
    expect(() => assertExecutionJobStatus("WAITING")).toThrow("Unknown execution job status");
    expect(() => assertWithdrawalStatus("WAITING")).toThrow("Unknown withdrawal status");
    expect(() => assertRiskLevel("blue")).toThrow("Unknown risk level");
  });

  it("maps domain statuses to explicit tones", () => {
    expect(approvalStatusTone(APPROVAL_STATUS.REJECTED)).toBe("red");
    expect(executionJobStatusTone(EXECUTION_JOB_STATUS.SUCCEEDED)).toBe("green");
    expect(withdrawalStatusTone(WITHDRAWAL_STATUS.CANCELLED)).toBe("gray");
  });
});
