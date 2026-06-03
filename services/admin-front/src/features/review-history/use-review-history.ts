"use client";

import { useEffect, useMemo, useState } from "react";

import {
  listProviderWithdrawReviewHistory,
  type ProviderWithdrawReviewHistoryItem,
} from "@/services/admin-api";

import {
  buildReviewHistoryFlow,
  buildReviewHistoryMetrics,
  collectReviewHistoryReviewers,
  collectReviewHistoryStatuses,
} from "./review-history-presenters";

export type ReviewHistoryFilters = {
  query: string;
  reviewer: string;
  currentStatus: string;
  reviewDecision: string;
  reviewedFrom: string;
  reviewedTo: string;
};

export const DEFAULT_REVIEW_HISTORY_FILTERS: ReviewHistoryFilters = {
  query: "",
  reviewer: "",
  currentStatus: "all",
  reviewDecision: "all",
  reviewedFrom: "",
  reviewedTo: "",
};

export const REVIEW_HISTORY_PAGE_SIZE_OPTIONS = [10, 20, 50];

export function useReviewHistory(token: string | null) {
  const [items, setItems] = useState<ProviderWithdrawReviewHistoryItem[]>([]);
  const [draftFilters, setDraftFilters] = useState<ReviewHistoryFilters>(
    DEFAULT_REVIEW_HISTORY_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<ReviewHistoryFilters>(
    DEFAULT_REVIEW_HISTORY_FILTERS
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [pageSize, setPageSizeState] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [activeWithdrawalId, setActiveWithdrawalId] = useState<string | null>(
    null
  );
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  useReviewHistoryLoader({
    appliedFilters,
    cursor,
    pageSize,
    setError,
    setIsFetching,
    setItems,
    setNextCursor,
    setTotalCount,
    setTotalPages,
    token,
  });

  useActiveReviewHistoryGuard({
    activeWithdrawalId,
    items,
    setActiveWithdrawalId,
    setIsDetailOpen,
  });

  const metrics = useMemo(() => buildReviewHistoryMetrics(items), [items]);
  const statuses = useMemo(() => collectReviewHistoryStatuses(items), [items]);
  const reviewers = useMemo(
    () => collectReviewHistoryReviewers(items),
    [items]
  );
  const activeItem = useMemo(
    () =>
      items.find((item) => item.withdrawalId === activeWithdrawalId) ?? null,
    [activeWithdrawalId, items]
  );
  const activeFlow = useMemo(
    () => (activeItem ? buildReviewHistoryFlow(activeItem) : []),
    [activeItem]
  );

  return {
    activeFlow,
    activeItem,
    cursorHistory,
    draftFilters,
    error,
    isDetailOpen,
    isFetching,
    items,
    metrics,
    nextCursor,
    pageNumber: cursorHistory.length + 1,
    pageSize,
    reviewers,
    statuses,
    totalCount,
    totalPages,
    applySearch: () => {
      resetCursor(setCursor, setCursorHistory);
      setAppliedFilters(draftFilters);
    },
    closeDetail: () => setIsDetailOpen(false),
    goToNextPage: () => {
      if (!nextCursor) {
        return;
      }
      setCursorHistory((current) => [...current, cursor ?? ""]);
      setCursor(nextCursor);
    },
    goToPreviousPage: () => {
      if (cursorHistory.length === 0) {
        return;
      }
      const previousHistory = cursorHistory.slice(0, -1);
      const previousCursor = cursorHistory.at(-1) ?? null;
      setCursorHistory(previousHistory);
      setCursor(previousCursor || null);
    },
    openDetail: (item: ProviderWithdrawReviewHistoryItem) => {
      setActiveWithdrawalId(item.withdrawalId);
      setIsDetailOpen(true);
    },
    resetFilters: () => {
      resetCursor(setCursor, setCursorHistory);
      setDraftFilters(DEFAULT_REVIEW_HISTORY_FILTERS);
      setAppliedFilters(DEFAULT_REVIEW_HISTORY_FILTERS);
    },
    setPageSize: (nextPageSize: number) => {
      setPageSizeState(nextPageSize);
      resetCursor(setCursor, setCursorHistory);
    },
    updateDraftFilter: <Key extends keyof ReviewHistoryFilters>(
      key: Key,
      value: ReviewHistoryFilters[Key]
    ) => {
      setDraftFilters((current) => ({ ...current, [key]: value }));
    },
  };
}

function useReviewHistoryLoader({
  appliedFilters,
  cursor,
  pageSize,
  setError,
  setIsFetching,
  setItems,
  setNextCursor,
  setTotalCount,
  setTotalPages,
  token,
}: Readonly<{
  appliedFilters: ReviewHistoryFilters;
  cursor: string | null;
  pageSize: number;
  setError: (value: string | null) => void;
  setIsFetching: (value: boolean) => void;
  setItems: (items: ProviderWithdrawReviewHistoryItem[]) => void;
  setNextCursor: (value: string | null) => void;
  setTotalCount: (value: number) => void;
  setTotalPages: (value: number) => void;
  token: string | null;
}>) {
  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    void loadReviewHistoryPage({
      appliedFilters,
      cursor,
      isCancelled: () => cancelled,
      pageSize,
      setError,
      setIsFetching,
      setItems,
      setNextCursor,
      setTotalCount,
      setTotalPages,
      token,
    });
    return () => {
      cancelled = true;
    };
  }, [
    appliedFilters,
    cursor,
    pageSize,
    setError,
    setIsFetching,
    setItems,
    setNextCursor,
    setTotalCount,
    setTotalPages,
    token,
  ]);
}

async function loadReviewHistoryPage({
  appliedFilters,
  cursor,
  isCancelled,
  pageSize,
  setError,
  setIsFetching,
  setItems,
  setNextCursor,
  setTotalCount,
  setTotalPages,
  token,
}: Readonly<{
  appliedFilters: ReviewHistoryFilters;
  cursor: string | null;
  isCancelled: () => boolean;
  pageSize: number;
  setError: (value: string | null) => void;
  setIsFetching: (value: boolean) => void;
  setItems: (items: ProviderWithdrawReviewHistoryItem[]) => void;
  setNextCursor: (value: string | null) => void;
  setTotalCount: (value: number) => void;
  setTotalPages: (value: number) => void;
  token: string;
}>) {
  try {
    setIsFetching(true);
    const response = await listProviderWithdrawReviewHistory(token, {
      limit: pageSize,
      cursor: cursor ?? undefined,
      query: appliedFilters.query || undefined,
      reviewer: appliedFilters.reviewer || undefined,
      currentStatus: normalizeFilterValue(appliedFilters.currentStatus),
      reviewDecision: normalizeFilterValue(appliedFilters.reviewDecision),
      reviewedFrom: appliedFilters.reviewedFrom || undefined,
      reviewedTo: appliedFilters.reviewedTo || undefined,
    });

    if (!isCancelled()) {
      setItems(response.items);
      setNextCursor(response.nextCursor);
      setTotalCount(response.totalCount);
      setTotalPages(response.totalPages);
      setError(null);
    }
  } catch (loadError) {
    if (!isCancelled()) {
      setError(
        loadError instanceof Error ? loadError.message : "加载审核历史失败"
      );
    }
  } finally {
    if (!isCancelled()) {
      setIsFetching(false);
    }
  }
}

function useActiveReviewHistoryGuard({
  activeWithdrawalId,
  items,
  setActiveWithdrawalId,
  setIsDetailOpen,
}: Readonly<{
  activeWithdrawalId: string | null;
  items: ProviderWithdrawReviewHistoryItem[];
  setActiveWithdrawalId: (value: string | null) => void;
  setIsDetailOpen: (value: boolean) => void;
}>) {
  useEffect(() => {
    if (
      activeWithdrawalId &&
      !items.some((item) => item.withdrawalId === activeWithdrawalId)
    ) {
      setIsDetailOpen(false);
      setActiveWithdrawalId(null);
    }
  }, [activeWithdrawalId, items, setActiveWithdrawalId, setIsDetailOpen]);
}

function normalizeFilterValue(value: string): string | undefined {
  return value === "all" || value === "" ? undefined : value;
}

function resetCursor(
  setCursor: (value: string | null) => void,
  setCursorHistory: (value: string[]) => void
) {
  setCursor(null);
  setCursorHistory([]);
}
