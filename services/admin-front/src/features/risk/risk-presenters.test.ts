import { describe, expect, it } from "vitest";

import {
  buildRiskMetrics,
  filterRiskApprovals,
  filterVisibleRiskItems,
  getRiskLevelTone,
  getRiskStatusTone,
  sortRiskItems,
} from "./risk-presenters";

const approvals = [
  {
    approvalId: "risk-1",
    approvalType: "provider_withdraw_review",
    status: "UNDER_REVIEW",
    approvalLevel: "L3",
    requesterRole: "reviewer",
    amountUsdc: "10",
    createdAt: "2026-03-21T10:00:00Z",
  },
  {
    approvalId: "risk-2",
    approvalType: "menu_publish",
    status: "SUBMITTED",
    approvalLevel: "L2",
    requesterRole: "ops",
    amountUsdc: "1",
    createdAt: "2026-03-21T09:00:00Z",
  },
  {
    approvalId: "risk-3",
    approvalType: "deposit_repair",
    status: "EXECUTED",
    approvalLevel: "L1",
    requesterRole: "finance",
    amountUsdc: "2",
    createdAt: "2026-03-21T08:00:00Z",
  },
];

describe("risk-presenters", () => {
  it("keeps risk-sensitive approvals", () => {
    expect(
      filterRiskApprovals(approvals).map((item) => item.approvalId)
    ).toEqual(["risk-1", "risk-2", "risk-3"]);
  });

  it("builds queue metrics", () => {
    expect(buildRiskMetrics(approvals)).toEqual({
      total: 3,
      red: 1,
      yellow: 1,
      underReview: 1,
      submitted: 1,
    });
  });

  it("filters visible items by search and level", () => {
    expect(
      filterVisibleRiskItems(approvals, "reviewer", "L3").map(
        (item) => item.approvalId
      )
    ).toEqual(["risk-1"]);
  });

  it("sorts higher-risk items first", () => {
    expect(sortRiskItems(approvals).map((item) => item.approvalId)).toEqual([
      "risk-1",
      "risk-2",
      "risk-3",
    ]);
  });

  it("maps risk tones", () => {
    expect(getRiskLevelTone("L3")).toBe("red");
    expect(getRiskLevelTone("L2")).toBe("orange");
    expect(getRiskLevelTone("L1")).toBe("gray");
    expect(getRiskStatusTone("UNDER_REVIEW")).toBe("orange");
    expect(getRiskStatusTone("SUBMITTED")).toBe("gray");
    expect(getRiskStatusTone("EXECUTED")).toBe("green");
  });
});
