"use client";

import { useEffect, useMemo, useState } from "react";

import type { ProviderWithdrawReviewItem } from "@/services/admin-api";

import {
  filterWithdrawReviews,
  paginateWithdrawReviews,
} from "./review-presenters";
import {
  DEFAULT_WITHDRAWAL_REVIEW_FILTERS,
  WITHDRAWAL_REVIEW_PAGE_SIZE,
  type WithdrawalReviewFilters,
} from "./withdrawal-review-types";

export function useWithdrawalReviewFilters(
  items: ProviderWithdrawReviewItem[]
) {
  const [draftFilters, setDraftFilters] = useState<WithdrawalReviewFilters>(
    DEFAULT_WITHDRAWAL_REVIEW_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<WithdrawalReviewFilters>(
    DEFAULT_WITHDRAWAL_REVIEW_FILTERS
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(WITHDRAWAL_REVIEW_PAGE_SIZE);

  useUrlFilters({ setAppliedFilters, setDraftFilters });
  useEffect(() => {
    setCurrentPage(1);
  }, [appliedFilters, pageSize]);

  const filteredItems = useMemo(
    () =>
      filterWithdrawReviews(
        items,
        appliedFilters.query,
        appliedFilters.riskLevel
      ),
    [appliedFilters, items]
  );
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  return {
    draftFilters,
    appliedFilters,
    currentPage,
    pageSize,
    filteredItems,
    visibleItems: paginateWithdrawReviews(filteredItems, currentPage, pageSize),
    totalPages,
    setDraftFilters,
    setCurrentPage,
    setPageSize,
    applySearch: () => {
      setAppliedFilters(draftFilters);
      setCurrentPage(1);
    },
    resetFilters: () => {
      setDraftFilters(DEFAULT_WITHDRAWAL_REVIEW_FILTERS);
      setAppliedFilters(DEFAULT_WITHDRAWAL_REVIEW_FILTERS);
      setCurrentPage(1);
    },
  };
}

function useUrlFilters({
  setAppliedFilters,
  setDraftFilters,
}: Readonly<{
  setAppliedFilters: (filters: WithdrawalReviewFilters) => void;
  setDraftFilters: (filters: WithdrawalReviewFilters) => void;
}>) {
  useEffect(() => {
    if (globalThis.window === undefined) {
      return;
    }

    const params = new URLSearchParams(globalThis.window.location.search);
    const nextFilters = {
      query: params.get("q") ?? "",
      riskLevel: params.get("risk") ?? "all",
    };
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
  }, [setAppliedFilters, setDraftFilters]);
}
