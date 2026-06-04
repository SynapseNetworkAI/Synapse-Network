"use client";

import { useEffect, useState } from "react";

import type { ProviderWithdrawReviewItem } from "@/services/admin-api";

export function useWithdrawalReviewDetail({
  activeReviewId,
  filteredItems,
  resetActionState,
  setActiveReviewId,
  setDecisionNote,
  setMessage,
}: Readonly<{
  activeReviewId: string | null;
  filteredItems: ProviderWithdrawReviewItem[];
  resetActionState: () => void;
  setActiveReviewId: (withdrawalId: string | null) => void;
  setDecisionNote: (value: string) => void;
  setMessage: (value: string | null) => void;
}>) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailReviewSnapshot, setDetailReviewSnapshot] =
    useState<ProviderWithdrawReviewItem | null>(null);
  const activeReview =
    filteredItems.find((item) => item.withdrawalId === activeReviewId) ?? null;
  const detailReview = isDetailOpen
    ? detailReviewSnapshot ?? activeReview
    : activeReview;

  useActiveReviewSync({
    activeReviewId,
    detailReviewSnapshot,
    filteredItems,
    isDetailOpen,
    setActiveReviewId,
    setDecisionNote,
  });

  return {
    activeReview,
    detailReview,
    isDetailOpen,
    closeReviewDetail: () => {
      setIsDetailOpen(false);
      setDetailReviewSnapshot(null);
      resetActionState();
      if (activeReviewId && !hasReview(filteredItems, activeReviewId)) {
        setActiveReviewId(filteredItems[0]?.withdrawalId ?? null);
      }
    },
    openReviewDetail: (review: ProviderWithdrawReviewItem) => {
      setActiveReviewId(review.withdrawalId);
      setDetailReviewSnapshot(review);
      resetActionState();
      setMessage(null);
      setIsDetailOpen(true);
    },
  };
}

function useActiveReviewSync({
  activeReviewId,
  detailReviewSnapshot,
  filteredItems,
  isDetailOpen,
  setActiveReviewId,
  setDecisionNote,
}: Readonly<{
  activeReviewId: string | null;
  detailReviewSnapshot: ProviderWithdrawReviewItem | null;
  filteredItems: ProviderWithdrawReviewItem[];
  isDetailOpen: boolean;
  setActiveReviewId: (withdrawalId: string | null) => void;
  setDecisionNote: (value: string) => void;
}>) {
  useEffect(() => {
    if (isDetailOpen && detailReviewSnapshot?.withdrawalId === activeReviewId) {
      return;
    }

    const nextActiveId = hasReview(filteredItems, activeReviewId)
      ? activeReviewId
      : filteredItems[0]?.withdrawalId ?? null;
    if (nextActiveId !== activeReviewId) {
      setActiveReviewId(nextActiveId);
      setDecisionNote("");
    }
  }, [
    activeReviewId,
    detailReviewSnapshot,
    filteredItems,
    isDetailOpen,
    setActiveReviewId,
    setDecisionNote,
  ]);
}

function hasReview(
  items: ProviderWithdrawReviewItem[],
  withdrawalId: string | null
) {
  return items.some((item) => item.withdrawalId === withdrawalId);
}
