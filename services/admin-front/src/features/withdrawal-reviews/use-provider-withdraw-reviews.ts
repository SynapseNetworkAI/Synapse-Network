"use client";

import { useEffect, useState } from "react";

import {
  decideProviderWithdrawReview,
  listProviderWithdrawReviews,
  type ProviderWithdrawReviewItem,
} from "@/services/admin-api";
import {
  getWithdrawReviewActionErrorMessage,
  getWithdrawReviewActionSuccessMessage,
  type WithdrawReviewActionPhase,
  type WithdrawReviewDecision,
} from "@/features/withdrawal-reviews/review-action-feedback";

export const REVIEW_QUEUE_FETCH_LIMIT = 100;

type RequestStepUpCode = (input: {
  title: string;
  description: string;
  confirmLabel: string;
}) => Promise<string | undefined>;

type UseProviderWithdrawReviewsResult = {
  items: ProviderWithdrawReviewItem[];
  activeReviewId: string | null;
  decisionNote: string;
  message: string | null;
  error: string | null;
  isPending: boolean;
  actionPhase: WithdrawReviewActionPhase;
  pendingDecision: WithdrawReviewDecision | null;
  setActiveReviewId: (withdrawalId: string | null) => void;
  setDecisionNote: (value: string) => void;
  setMessage: (value: string | null) => void;
  setError: (value: string | null) => void;
  handleDecision: (decision: "APPROVE" | "REJECT") => void;
  refreshReviews: () => Promise<void>;
};

export function applyOptimisticWithdrawReviewDecision(
  items: ProviderWithdrawReviewItem[],
  withdrawalId: string,
  result: {
    status: ProviderWithdrawReviewItem["status"];
    message?: string | null;
  }
): ProviderWithdrawReviewItem[] {
  const updatedAt = new Date().toISOString();
  return items.map((item) =>
    item.withdrawalId === withdrawalId
      ? {
          ...item,
          status: result.status,
          message: result.message ?? item.message,
          updatedAt,
        }
      : item
  );
}

export function useProviderWithdrawReviews(
  token: string | null,
  requestStepUpCode: RequestStepUpCode
): UseProviderWithdrawReviewsResult {
  const [items, setItems] = useState<ProviderWithdrawReviewItem[]>([]);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionPhase, setActionPhase] =
    useState<WithdrawReviewActionPhase>("idle");
  const [pendingDecision, setPendingDecision] =
    useState<WithdrawReviewDecision | null>(null);

  const isPending = actionPhase !== "idle";

  async function refreshReviews() {
    if (!token) {
      setItems([]);
      setActiveReviewId(null);
      setError(null);
      return;
    }
    const reviewQueue = await listProviderWithdrawReviews(token, {
      limit: REVIEW_QUEUE_FETCH_LIMIT,
    });
    setItems(reviewQueue.items);
    setActiveReviewId((current) => {
      if (
        current &&
        reviewQueue.items.some((item) => item.withdrawalId === current)
      ) {
        return current;
      }
      return reviewQueue.items[0]?.withdrawalId ?? null;
    });
  }

  useEffect(() => {
    if (!token) {
      setItems([]);
      setActiveReviewId(null);
      setError(null);
      return;
    }
    const activeToken = token;
    let cancelled = false;

    async function load() {
      try {
        const reviewQueue = await listProviderWithdrawReviews(activeToken, {
          limit: REVIEW_QUEUE_FETCH_LIMIT,
        });
        if (cancelled) {
          return;
        }
        setItems(reviewQueue.items);
        setActiveReviewId(reviewQueue.items[0]?.withdrawalId ?? null);
        setError(null);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "加载提现审核队列失败"
        );
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function handleDecision(decision: "APPROVE" | "REJECT") {
    if (!token || !activeReviewId) {
      return;
    }
    const note = decisionNote.trim();
    if (decision === "REJECT" && !note) {
      setError("驳回前请填写处理备注，说明不通过的原因，方便后续跟进。");
      return;
    }
    setError(null);
    setMessage(null);
    setPendingDecision(decision);
    setActionPhase("awaitingOtp");

    void (async () => {
      const reviewId = activeReviewId;
      try {
        const otpCode = await requestStepUpCode({
          title: `${decision === "APPROVE" ? "批准" : "拒绝"}提现单`,
          description: `你正在处理 ${reviewId}，完成验证码验证后系统才会提交${
            decision === "APPROVE" ? "放行" : "驳回"
          }请求。`,
          confirmLabel: decision === "APPROVE" ? "确认放行" : "确认驳回",
        });

        setActionPhase("submitting");
        const result = await decideProviderWithdrawReview(token, reviewId, {
          decision,
          note,
          otpCode,
        });
        setItems((current) =>
          applyOptimisticWithdrawReviewDecision(current, reviewId, result)
        );
        setMessage(
          getWithdrawReviewActionSuccessMessage({
            decision,
            status: result.status,
            message: result.message,
          })
        );
        setError(null);
        setDecisionNote("");
        await refreshReviews();
      } catch (actionError) {
        setError(getWithdrawReviewActionErrorMessage(actionError, decision));
      } finally {
        setActionPhase("idle");
        setPendingDecision(null);
      }
    })();
  }

  return {
    items,
    activeReviewId,
    decisionNote,
    message,
    error,
    isPending,
    actionPhase,
    pendingDecision,
    setActiveReviewId,
    setDecisionNote,
    setMessage,
    setError,
    handleDecision,
    refreshReviews,
  };
}
