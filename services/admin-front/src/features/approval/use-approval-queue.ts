"use client";

import { useEffect, useMemo, useState } from "react";

import { listApprovals, type ApprovalItem } from "@/services/admin-api";

import {
  buildApprovalMetrics,
  filterApprovals,
  listApprovalTypes,
  sortApprovalsByPriority,
} from "./approval-presenters";

export type ApprovalFilters = {
  query: string;
  type: string;
  status: string;
};

export const APPROVAL_DEFAULT_FILTERS: ApprovalFilters = {
  query: "",
  status: "all",
  type: "all",
};

export const APPROVAL_PAGE_SIZE_OPTIONS = [10, 20, 50];

export function useApprovalQueue(token: string | null) {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [draftFilters, setDraftFilters] = useState<ApprovalFilters>(
    APPROVAL_DEFAULT_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<ApprovalFilters>(
    APPROVAL_DEFAULT_FILTERS
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [error, setError] = useState<string | null>(null);

  useInitialApprovalFilters(setAppliedFilters, setDraftFilters);
  useApprovalLoader({ setError, setItems, token });

  const filteredItems = useMemo(
    () =>
      sortApprovalsByPriority(
        filterApprovals(
          items,
          appliedFilters.query,
          appliedFilters.type,
          appliedFilters.status
        )
      ),
    [appliedFilters, items]
  );
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedFilters, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  function applySearch() {
    setAppliedFilters(draftFilters);
    setCurrentPage(1);
  }

  function resetFilters() {
    setDraftFilters(APPROVAL_DEFAULT_FILTERS);
    setAppliedFilters(APPROVAL_DEFAULT_FILTERS);
    setCurrentPage(1);
  }

  return {
    applySearch,
    approvalTypes: useMemo(() => listApprovalTypes(items), [items]),
    currentPage,
    draftFilters,
    error,
    filteredItems,
    hotItems: filteredItems.slice(0, 4),
    items,
    metrics: useMemo(() => buildApprovalMetrics(items), [items]),
    pageSize,
    resetFilters,
    setCurrentPage,
    setDraftFilters,
    setPageSize,
    totalPages,
    visibleItems: useMemo(
      () =>
        filteredItems.slice(
          (currentPage - 1) * pageSize,
          currentPage * pageSize
        ),
      [currentPage, filteredItems, pageSize]
    ),
  };
}

function useInitialApprovalFilters(
  setAppliedFilters: (filters: ApprovalFilters) => void,
  setDraftFilters: (filters: ApprovalFilters) => void
) {
  useEffect(() => {
    if (globalThis.window === undefined) {
      return;
    }

    const params = new URLSearchParams(globalThis.window.location.search);
    const nextFilters = {
      query: params.get("q") ?? "",
      status: params.get("status") ?? "all",
      type: params.get("type") ?? "all",
    };
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
  }, [setAppliedFilters, setDraftFilters]);
}

function useApprovalLoader({
  setError,
  setItems,
  token,
}: Readonly<{
  setError: (value: string | null) => void;
  setItems: (items: ApprovalItem[]) => void;
  token: string | null;
}>) {
  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    void loadApprovalItems({
      isCancelled: () => cancelled,
      setError,
      setItems,
      token,
    });
    return () => {
      cancelled = true;
    };
  }, [setError, setItems, token]);
}

async function loadApprovalItems({
  isCancelled,
  setError,
  setItems,
  token,
}: Readonly<{
  isCancelled: () => boolean;
  setError: (value: string | null) => void;
  setItems: (items: ApprovalItem[]) => void;
  token: string;
}>) {
  try {
    const approvals = await listApprovals(token);
    if (isCancelled()) {
      return;
    }
    setItems(approvals.items);
  } catch (loadError) {
    if (!isCancelled()) {
      setError(
        loadError instanceof Error ? loadError.message : "加载审批列表失败"
      );
    }
  }
}
