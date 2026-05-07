import { describe, expect, it } from "vitest";

import type { ProviderWithdrawReviewItem } from "@/services/admin-api";

import {
  getWithdrawReviewActionLockState,
  isWithdrawReviewAwaitingDecision,
} from "./review-action-lock";

const review: ProviderWithdrawReviewItem = {
  withdrawalId: "wd-001",
  withdrawalKind: "provider_withdrawal",
  reviewType: "provider_withdraw_review",
  ownerAddress: "0xabc",
  subjectAddress: "0xabc",
  amountUsdc: "12.50",
  status: "PENDING_MANUAL_REVIEW",
  requestId: "req-001",
  txHash: null,
  riskLevel: "yellow",
  riskReasonCode: "manual_review",
  evidenceSummary: null,
  message: null,
  createdAt: "2026-03-21T12:00:00Z",
  updatedAt: "2026-03-21T12:10:00Z",
};

describe("review-action-lock", () => {
  it("locks review actions after submit or when backend status is no longer reviewable", () => {
    expect(isWithdrawReviewAwaitingDecision(review)).toBe(true);
    expect(
      getWithdrawReviewActionLockState({ item: review, canDecide: true })
    ).toEqual({
      locked: false,
      reason: null,
    });
    expect(
      getWithdrawReviewActionLockState({
        item: review,
        canDecide: true,
        submittedDecision: "APPROVE",
      })
    ).toEqual({ locked: true, reason: "submitted" });
    expect(
      getWithdrawReviewActionLockState({
        item: { ...review, status: "REQUESTED" },
        canDecide: true,
      })
    ).toEqual({ locked: true, reason: "status" });
    expect(
      getWithdrawReviewActionLockState({ item: review, canDecide: false })
    ).toEqual({
      locked: true,
      reason: "permission",
    });
  });
});
