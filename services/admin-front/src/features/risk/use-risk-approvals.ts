"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { listApprovals, type ApprovalItem } from "@/services/admin-api";

import {
  buildRiskMetrics,
  filterRiskApprovals,
  filterVisibleRiskItems,
  sortRiskItems,
} from "./risk-presenters";

export function useRiskApprovals(token: string | null) {
  const [riskItems, setRiskItems] = useState<ApprovalItem[]>([]);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    void loadRiskApprovals({
      isCancelled: () => cancelled,
      setError,
      setRiskItems,
      token,
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return {
    error,
    levelFilter,
    metrics: useMemo(() => buildRiskMetrics(riskItems), [riskItems]),
    riskItems,
    search,
    setLevelFilter,
    setSearch,
    visibleRiskItems: useMemo(
      () =>
        sortRiskItems(
          filterVisibleRiskItems(riskItems, deferredSearch, levelFilter)
        ),
      [deferredSearch, levelFilter, riskItems]
    ),
  };
}

async function loadRiskApprovals({
  isCancelled,
  setError,
  setRiskItems,
  token,
}: Readonly<{
  isCancelled: () => boolean;
  setError: (value: string | null) => void;
  setRiskItems: (items: ApprovalItem[]) => void;
  token: string;
}>) {
  try {
    const approvals = await listApprovals(token, { limit: 20 });
    if (!isCancelled()) {
      setRiskItems(filterRiskApprovals(approvals.items));
    }
  } catch (loadError) {
    if (!isCancelled()) {
      setError(
        loadError instanceof Error ? loadError.message : "加载风控模块失败"
      );
    }
  }
}
