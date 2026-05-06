import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderWithdrawReviewItem } from "@/services/admin-api";

import {
  applyOptimisticWithdrawReviewDecision,
  REVIEW_QUEUE_FETCH_LIMIT,
} from "./use-provider-withdraw-reviews";

function buildItem(
  overrides: Partial<ProviderWithdrawReviewItem> = {}
): ProviderWithdrawReviewItem {
  return {
    withdrawalId: "wd-1",
    withdrawalKind: "provider_withdrawal",
    reviewType: "provider_withdraw_review",
    ownerAddress: "0xabc",
    subjectAddress: "0xabc",
    amountUsdc: "10.000000",
    status: "PENDING_MANUAL_REVIEW",
    requestId: "req-1",
    txHash: null,
    riskLevel: "red",
    riskReasonCode: "DAILY_WITHDRAW_LIMIT_EXCEEDED",
    evidenceSummary: "manual review",
    message: null,
    createdAt: "2026-05-06T00:00:00Z",
    updatedAt: "2026-05-06T00:00:00Z",
    ...overrides,
  };
}

describe("applyOptimisticWithdrawReviewDecision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the reviewed item as non-pending immediately after success", () => {
    const items = [buildItem(), buildItem({ withdrawalId: "wd-2" })];

    const next = applyOptimisticWithdrawReviewDecision(items, "wd-1", {
      status: "REQUESTED",
      message: "submitted",
    });

    expect(next[0]?.status).toBe("REQUESTED");
    expect(next[0]?.message).toBe("submitted");
    expect(next[0]?.updatedAt).not.toBe(items[0]?.updatedAt);
    expect(next[1]).toEqual(items[1]);
  });

  it("keeps the queue fetch limit widened so URL search can see recent reviews", () => {
    expect(REVIEW_QUEUE_FETCH_LIMIT).toBe(100);
  });
});
