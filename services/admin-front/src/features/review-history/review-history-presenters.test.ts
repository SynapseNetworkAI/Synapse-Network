import { describe, expect, it } from "vitest";

import { buildReviewHistoryFlow, buildReviewHistoryMetrics, collectReviewHistoryReviewers, collectReviewHistoryStatuses, filterReviewHistoryItems, getReviewDecisionLabel, getReviewDecisionTone, getReviewHistoryStatusLabel, getReviewHistoryStatusTone, sortReviewHistoryItems } from "./review-history-presenters";
import type { ProviderWithdrawReviewHistoryItem } from "@/services/admin-api";

const items: ProviderWithdrawReviewHistoryItem[] = [
  {
    withdrawalId: "wd-1",
    ownerAddress: "0xabc",
    amountUsdc: "120.00",
    requestId: "req-1",
    txHash: null,
    riskLevel: "yellow",
    riskReasonCode: "AUTO_SINGLE_LIMIT_EXCEEDED",
    evidenceSummary: "Reviewer confirmed provider income is consistent.",
    reviewDecision: "APPROVE",
    currentStatus: "COMPLETED",
    reviewerEmail: "finance-review@synapse.network",
    reviewerRole: "finance_reviewer",
    reviewerNote: "Looks good",
    message: null,
    createdAt: "2026-03-20T09:00:00Z",
    updatedAt: "2026-03-20T11:00:00Z",
    reviewedAt: "2026-03-20T10:00:00Z",
  },
  {
    withdrawalId: "wd-2",
    ownerAddress: "0xdef",
    amountUsdc: "88.00",
    requestId: "req-2",
    txHash: null,
    riskLevel: "red",
    riskReasonCode: "AUTO_24H_LIMIT_EXCEEDED",
    evidenceSummary: "Aggregate amount exceeds threshold.",
    reviewDecision: "REJECT",
    currentStatus: "REJECTED",
    reviewerEmail: "finance-review@synapse.network",
    reviewerRole: "finance_reviewer",
    reviewerNote: "Need more evidence",
    message: null,
    createdAt: "2026-03-19T08:00:00Z",
    updatedAt: "2026-03-19T09:00:00Z",
    reviewedAt: "2026-03-19T09:00:00Z",
  },
  {
    withdrawalId: "wd-3",
    ownerAddress: "0xghi",
    amountUsdc: "42.00",
    requestId: "req-3",
    txHash: null,
    riskLevel: "yellow",
    riskReasonCode: "AUTO_SINGLE_LIMIT_EXCEEDED",
    evidenceSummary: "Earlier decision later rolled back by ticket expiry.",
    reviewDecision: "APPROVE",
    currentStatus: "CANCELLED",
    reviewerEmail: "finance-review@synapse.network",
    reviewerRole: "finance_reviewer",
    reviewerNote: "Approved earlier",
    message: "Expired ticket released",
    createdAt: "2026-03-18T07:00:00Z",
    updatedAt: "2026-03-18T10:00:00Z",
    reviewedAt: "2026-03-18T08:00:00Z",
  },
];

describe("review history presenters", () => {
  it("builds summary metrics", () => {
    expect(buildReviewHistoryMetrics(items)).toEqual({
      total: 3,
      approved: 2,
      completed: 1,
      rejected: 1,
      cancelled: 1,
    });
  });

  it("filters by search, status, and decision", () => {
    expect(filterReviewHistoryItems(items, "wd-2", "all", "all").map((item) => item.withdrawalId)).toEqual(["wd-2"]);
    expect(filterReviewHistoryItems(items, "", "CANCELLED", "APPROVE").map((item) => item.withdrawalId)).toEqual(["wd-3"]);
  });

  it("sorts newest first", () => {
    expect(sortReviewHistoryItems(items).map((item) => item.withdrawalId)).toEqual(["wd-1", "wd-2", "wd-3"]);
  });

  it("collects current statuses", () => {
    expect(collectReviewHistoryStatuses(items)).toEqual(["COMPLETED", "REJECTED", "CANCELLED"]);
  });

  it("collects reviewers", () => {
    expect(collectReviewHistoryReviewers(items)).toEqual(["finance-review@synapse.network"]);
  });

  it("maps labels and tones", () => {
    expect(getReviewHistoryStatusLabel("CANCELLED")).toBe("已取消 / 已释放");
    expect(getReviewHistoryStatusTone("COMPLETED")).toBe("green");
    expect(getReviewDecisionLabel("APPROVE")).toBe("放行");
    expect(getReviewDecisionTone("REJECT")).toBe("red");
  });

  it("builds status flow for drawer detail", () => {
    expect(buildReviewHistoryFlow(items[0]).map((step) => step.label)).toEqual(["进入人工审核", "已放行", "已完成"]);
    expect(buildReviewHistoryFlow(items[1]).map((step) => step.label)).toEqual(["进入人工审核", "已驳回"]);
  });
});