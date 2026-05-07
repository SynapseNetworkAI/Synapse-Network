import type { ProviderWithdrawReviewItem } from "@/services/admin-api";

import type { WithdrawReviewDecision } from "./review-action-feedback";

export function isWithdrawReviewAwaitingDecision(
  item: ProviderWithdrawReviewItem
): boolean {
  return item.status === "PENDING_MANUAL_REVIEW";
}

export function getWithdrawReviewActionLockState(input: {
  item: ProviderWithdrawReviewItem | null;
  canDecide: boolean;
  submittedDecision?: WithdrawReviewDecision;
}): { locked: boolean; reason: "permission" | "submitted" | "status" | null } {
  if (!input.canDecide) {
    return { locked: true, reason: "permission" };
  }
  if (!input.item) {
    return { locked: true, reason: "status" };
  }
  if (input.submittedDecision) {
    return { locked: true, reason: "submitted" };
  }
  if (!isWithdrawReviewAwaitingDecision(input.item)) {
    return { locked: true, reason: "status" };
  }
  return { locked: false, reason: null };
}
