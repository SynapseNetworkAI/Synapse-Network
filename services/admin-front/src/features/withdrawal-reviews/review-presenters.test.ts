import { describe, expect, it } from "vitest";

import {
  buildWithdrawReasonClusters,
  buildWithdrawReviewMetrics,
  filterWithdrawReviews,
  getWithdrawalStatusLabel,
  getWithdrawalStatusTone,
  getWithdrawReviewKindLabel,
  getWithdrawReviewKindTone,
  getWithdrawRiskTone,
  listWithdrawRiskLevels,
  paginateWithdrawReviews,
} from "./review-presenters";

const reviews = [
  {
    withdrawalId: "wd-002",
    withdrawalKind: "provider_withdrawal",
    reviewType: "provider_withdraw_review",
    ownerAddress: "0xbbb",
    subjectAddress: "0xbbb",
    amountUsdc: "12.50",
    status: "PENDING_MANUAL_REVIEW",
    requestId: "req-002",
    txHash: null,
    riskLevel: "yellow",
    riskReasonCode: "velocity_spike",
    evidenceSummary: null,
    message: null,
    createdAt: "2026-03-21T12:00:00Z",
    updatedAt: "2026-03-21T12:10:00Z",
  },
  {
    withdrawalId: "wd-001",
    withdrawalKind: "consumer_refund",
    reviewType: "consumer_withdraw_review",
    ownerAddress: "0xaaa",
    subjectAddress: "0xaaa",
    amountUsdc: "120.00",
    status: "PENDING_MANUAL_REVIEW",
    requestId: "req-001",
    txHash: "0xhash",
    riskLevel: "red",
    riskReasonCode: "wallet_mismatch",
    evidenceSummary: "Owner and device fingerprint mismatch",
    message: null,
    createdAt: "2026-03-21T10:00:00Z",
    updatedAt: "2026-03-21T10:10:00Z",
  },
  {
    withdrawalId: "wd-003",
    withdrawalKind: "provider_withdrawal",
    reviewType: "provider_withdraw_review",
    ownerAddress: "0xccc",
    subjectAddress: "0xccc",
    amountUsdc: "8.00",
    status: "PENDING_MANUAL_REVIEW",
    requestId: null,
    txHash: null,
    riskLevel: null,
    riskReasonCode: null,
    evidenceSummary: "manual review only",
    message: null,
    createdAt: "2026-03-21T09:00:00Z",
    updatedAt: "2026-03-21T09:10:00Z",
  },
];

describe("review-presenters", () => {
  it("builds aggregate review metrics", () => {
    expect(buildWithdrawReviewMetrics(reviews)).toEqual({
      pendingCount: 3,
      totalAmount: 140.5,
      redCount: 1,
      yellowCount: 1,
      linkedCount: 1,
    });
  });

  it("filters by search and risk level", () => {
    expect(
      filterWithdrawReviews(reviews, "wallet", "red").map(
        (item) => item.withdrawalId
      )
    ).toEqual(["wd-001"]);
  });

  it("preserves API created-at-desc order for the default list", () => {
    expect(
      filterWithdrawReviews(reviews, "", "all").map((item) => item.withdrawalId)
    ).toEqual(["wd-002", "wd-001", "wd-003"]);
  });

  it("clusters risk reasons and exposes known risk levels", () => {
    expect(buildWithdrawReasonClusters(reviews)).toEqual([
      { code: "manual_review", count: 1 },
      { code: "velocity_spike", count: 1 },
      { code: "wallet_mismatch", count: 1 },
    ]);
    expect(listWithdrawRiskLevels(reviews)).toEqual(["yellow", "red"]);
    expect(getWithdrawRiskTone("yellow")).toBe("orange");
    expect(getWithdrawReviewKindLabel(reviews[1])).toBe("Consumer withdrawal");
    expect(getWithdrawReviewKindTone(reviews[1])).toBe("orange");
    expect(getWithdrawalStatusLabel("PENDING_MANUAL_REVIEW")).toBe(
      "待人工审核"
    );
    expect(getWithdrawalStatusTone("PENDING_MANUAL_REVIEW")).toBe("orange");
  });

  it("returns only the reviews for the requested page", () => {
    expect(
      paginateWithdrawReviews(reviews, 1, 2).map((item) => item.withdrawalId)
    ).toEqual(["wd-002", "wd-001"]);
    expect(
      paginateWithdrawReviews(reviews, 2, 2).map((item) => item.withdrawalId)
    ).toEqual(["wd-003"]);
  });
});
