import { describe, expect, it } from "vitest";

import { buildApprovalMetrics, filterApprovals, getApprovalStatusLabel, getApprovalStatusTone, getApprovalTypeLabel, sortApprovalsByPriority } from "./approval-presenters";

const approvals = [
  {
    approvalId: "appr-003",
    approvalType: "refund_approve",
    status: "APPROVED_PENDING_EXECUTION",
    approvalLevel: "L2",
    requesterRole: "finance_operator",
    amountUsdc: "12.00",
    createdAt: "2026-03-21T09:00:00Z",
  },
  {
    approvalId: "appr-001",
    approvalType: "provider_withdraw_review",
    status: "SUBMITTED",
    approvalLevel: "L3",
    requesterRole: "risk_reviewer",
    amountUsdc: "150.50",
    createdAt: "2026-03-21T10:00:00Z",
  },
  {
    approvalId: "appr-002",
    approvalType: "deposit_repair",
    status: "UNDER_REVIEW",
    approvalLevel: "L1",
    requesterRole: "ops",
    amountUsdc: "8.00",
    createdAt: "2026-03-21T11:00:00Z",
  },
];

describe("approval-presenters", () => {
  it("builds aggregate metrics", () => {
    expect(buildApprovalMetrics(approvals)).toEqual({
      total: 3,
      l3Count: 1,
      awaitingReviewCount: 2,
      pendingExecutionCount: 1,
      projectedWithdrawCount: 1,
      projectedWithdrawAmount: 150.5,
    });
  });

  it("filters by search and status", () => {
    expect(filterApprovals(approvals, "risk", "all", "SUBMITTED").map((item) => item.approvalId)).toEqual(["appr-001"]);
  });

  it("sorts the hottest approvals first", () => {
    expect(sortApprovalsByPriority(approvals).map((item) => item.approvalId)).toEqual(["appr-001", "appr-003", "appr-002"]);
  });

  it("maps labels for known status and type", () => {
    expect(getApprovalTypeLabel("provider_withdraw_review")).toBe("Provider 提现人工审核");
    expect(getApprovalStatusLabel("APPROVED_PENDING_EXECUTION")).toBe("待执行");
    expect(getApprovalStatusTone("REJECTED")).toBe("red");
  });
});
