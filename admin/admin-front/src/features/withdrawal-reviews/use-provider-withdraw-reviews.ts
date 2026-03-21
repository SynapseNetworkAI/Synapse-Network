"use client";

import { useEffect, useState, useTransition } from "react";

import {
  decideProviderWithdrawReview,
  listProviderWithdrawReviews,
  type ProviderWithdrawReviewItem,
} from "@/services/admin-api";

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
  setActiveReviewId: (withdrawalId: string | null) => void;
  setDecisionNote: (value: string) => void;
  setMessage: (value: string | null) => void;
  setError: (value: string | null) => void;
  handleDecision: (decision: "APPROVE" | "REJECT") => void;
  refreshReviews: () => Promise<void>;
};


export function useProviderWithdrawReviews(
  token: string | null,
  requestStepUpCode: RequestStepUpCode,
): UseProviderWithdrawReviewsResult {
  const [items, setItems] = useState<ProviderWithdrawReviewItem[]>([]);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function refreshReviews() {
    if (!token) {
      setItems([]);
      setActiveReviewId(null);
      setError(null);
      return;
    }
    const reviewQueue = await listProviderWithdrawReviews(token, { limit: 20 });
    setItems(reviewQueue.items);
    setActiveReviewId((current) => {
      if (current && reviewQueue.items.some((item) => item.withdrawalId === current)) {
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
        const reviewQueue = await listProviderWithdrawReviews(activeToken, { limit: 20 });
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
        setError(loadError instanceof Error ? loadError.message : "加载提现审核队列失败");
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
      setError("Reject 需要 reviewer note，避免审计链路只剩一个状态码。");
      return;
    }
    startTransition(async () => {
      try {
        const result = await decideProviderWithdrawReview(token, activeReviewId, {
          decision,
          note,
          otpCode: await requestStepUpCode({
            title: `${decision === "APPROVE" ? "批准" : "拒绝"}提现单`,
            description: `你正在对 ${activeReviewId} 执行 ${decision}，该动作会推进 provider 资金状态并写入审计链路。`,
            confirmLabel: decision === "APPROVE" ? "确认批准" : "确认拒绝",
          }),
        });
        const messageSuffix = result.message ? ` · ${result.message}` : "";
        setMessage(`${result.reviewDecision} -> ${result.status}${messageSuffix}`);
        setError(null);
        setDecisionNote("");
        await refreshReviews();
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "提交提现审核动作失败");
      }
    });
  }

  return {
    items,
    activeReviewId,
    decisionNote,
    message,
    error,
    isPending,
    setActiveReviewId,
    setDecisionNote,
    setMessage,
    setError,
    handleDecision,
    refreshReviews,
  };
}