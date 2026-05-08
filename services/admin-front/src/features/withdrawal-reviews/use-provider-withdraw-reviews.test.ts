import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

import type { ProviderWithdrawReviewItem } from "@/services/admin-api";

import {
  applyOptimisticWithdrawReviewDecision,
  getWithdrawReviewLoadErrorMessage,
  loadProviderWithdrawReviewQueue,
  REVIEW_QUEUE_FETCH_LIMIT,
  resolveNextActiveReviewId,
  submitProviderWithdrawReviewDecision,
  useProviderWithdrawReviews,
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
    reviewExpiresAt: "2026-05-07T00:00:00Z",
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

describe("provider withdraw review queue helpers", () => {
  it("keeps the current active id when it still exists", () => {
    expect(
      resolveNextActiveReviewId("wd-2", [
        buildItem(),
        buildItem({ withdrawalId: "wd-2" }),
      ])
    ).toBe("wd-2");
  });

  it("falls back to the first queue item when the current id disappears", () => {
    expect(
      resolveNextActiveReviewId("wd-missing", [
        buildItem({ withdrawalId: "wd-9" }),
      ])
    ).toBe("wd-9");
    expect(resolveNextActiveReviewId(null, [])).toBeNull();
  });

  it("can keep the active id after a terminal decision removes it from the queue", () => {
    expect(
      resolveNextActiveReviewId(
        "wd-submitted",
        [buildItem({ withdrawalId: "wd-next" })],
        { keepMissingActive: true }
      )
    ).toBe("wd-submitted");
  });

  it("loads the review queue with the widened fetch limit", async () => {
    const listReviews = vi.fn().mockResolvedValue({
      items: [buildItem({ withdrawalId: "wd-7" })],
    });

    const result = await loadProviderWithdrawReviewQueue(
      "cookie-session",
      "wd-stale",
      listReviews
    );

    expect(listReviews).toHaveBeenCalledWith("cookie-session", {
      limit: REVIEW_QUEUE_FETCH_LIMIT,
    });
    expect(result.activeReviewId).toBe("wd-7");
  });

  it("normalizes load errors for queue fetch failures", () => {
    expect(getWithdrawReviewLoadErrorMessage(new Error("boom"))).toBe("boom");
    expect(getWithdrawReviewLoadErrorMessage("unknown")).toBe(
      "加载提现审核队列失败"
    );
  });
});

describe("submitProviderWithdrawReviewDecision", () => {
  it("submits approval, applies optimistic state, and refreshes reviews", async () => {
    let currentItems = [buildItem()];
    const setItems = vi.fn(
      (
        updater: (
          items: ProviderWithdrawReviewItem[]
        ) => ProviderWithdrawReviewItem[]
      ) => {
        currentItems = updater(currentItems);
      }
    );
    const setMessage = vi.fn();
    const setError = vi.fn();
    const setDecisionNote = vi.fn();
    const setActionPhase = vi.fn();
    const setPendingDecision = vi.fn();
    const requestStepUpCode = vi.fn().mockResolvedValue("123456");
    const refreshReviews = vi.fn().mockResolvedValue(undefined);
    const decideReview = vi.fn().mockResolvedValue({
      status: "REQUESTED",
      message: "submitted",
    });

    await submitProviderWithdrawReviewDecision({
      token: "cookie-session",
      activeReviewId: "wd-1",
      decision: "APPROVE",
      decisionNote: "  looks good  ",
      requestStepUpCode,
      refreshReviews,
      setItems,
      setMessage,
      setError,
      setDecisionNote,
      setActionPhase,
      setPendingDecision,
      decideReview,
    });

    expect(requestStepUpCode).toHaveBeenCalledOnce();
    expect(setActionPhase).toHaveBeenNthCalledWith(1, "submitting");
    expect(decideReview).toHaveBeenCalledWith("cookie-session", "wd-1", {
      decision: "APPROVE",
      note: "looks good",
      otpCode: "123456",
    });
    expect(setItems).toHaveBeenCalledOnce();
    expect(currentItems[0]?.status).toBe("REQUESTED");
    expect(setMessage).toHaveBeenCalledWith(
      "已提交放行处理，系统正在同步提现状态。"
    );
    expect(setError).toHaveBeenCalledWith(null);
    expect(setDecisionNote).toHaveBeenCalledWith("");
    expect(refreshReviews).toHaveBeenCalledWith({ keepMissingActive: true });
    expect(setActionPhase).toHaveBeenLastCalledWith("submitted");
    expect(setPendingDecision).not.toHaveBeenCalled();
  });

  it("maps submission failures to reviewer-facing errors", async () => {
    const setItems = vi.fn();
    const setMessage = vi.fn();
    const setError = vi.fn();
    const setDecisionNote = vi.fn();
    const setActionPhase = vi.fn();
    const setPendingDecision = vi.fn();
    const requestStepUpCode = vi.fn().mockResolvedValue("123456");
    const refreshReviews = vi.fn().mockResolvedValue(undefined);
    const decideReview = vi
      .fn()
      .mockRejectedValue(new Error("approval backend unavailable"));

    await submitProviderWithdrawReviewDecision({
      token: "cookie-session",
      activeReviewId: "wd-1",
      decision: "REJECT",
      decisionNote: "too risky",
      requestStepUpCode,
      refreshReviews,
      setItems,
      setMessage,
      setError,
      setDecisionNote,
      setActionPhase,
      setPendingDecision,
      decideReview,
    });

    expect(setItems).not.toHaveBeenCalled();
    expect(setMessage).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith("approval backend unavailable");
    expect(setActionPhase).toHaveBeenLastCalledWith("idle");
    expect(setPendingDecision).toHaveBeenLastCalledWith(null);
  });
});

describe("useProviderWithdrawReviews", () => {
  it("initializes hook state during server render without crashing", () => {
    function HookProbe(): ReactElement {
      const result = useProviderWithdrawReviews(
        "cookie-session",
        async () => undefined
      );
      expect(result.actionPhase).toBe("idle");
      expect(result.pendingDecision).toBeNull();
      expect(result.isPending).toBe(false);
      return createElement("div", null, result.activeReviewId ?? "none");
    }

    const html = renderToString(createElement(HookProbe));

    expect(html).toContain("none");
  });
});
