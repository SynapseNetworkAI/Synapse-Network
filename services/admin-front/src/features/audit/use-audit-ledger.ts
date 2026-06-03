"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { listAuditActions, type AuditActionItem } from "@/services/admin-api";

import {
  buildAuditMetrics,
  collectAuditStatuses,
  filterAuditItems,
  sortAuditItems,
  topAuditErrorCodes,
} from "./audit-presenters";

export function useAuditLedger(token: string | null) {
  const [items, setItems] = useState<AuditActionItem[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    void loadAuditItems({
      isCancelled: () => cancelled,
      setError,
      setItems,
      token,
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return {
    error,
    errorCodes: useMemo(() => topAuditErrorCodes(items), [items]),
    items,
    metrics: useMemo(() => buildAuditMetrics(items), [items]),
    search,
    setSearch,
    setStatusFilter,
    statusFilter,
    statuses: useMemo(() => collectAuditStatuses(items), [items]),
    visibleItems: useMemo(
      () =>
        sortAuditItems(filterAuditItems(items, deferredSearch, statusFilter)),
      [deferredSearch, items, statusFilter]
    ),
  };
}

async function loadAuditItems({
  isCancelled,
  setError,
  setItems,
  token,
}: Readonly<{
  isCancelled: () => boolean;
  setError: (value: string | null) => void;
  setItems: (items: AuditActionItem[]) => void;
  token: string;
}>) {
  try {
    const response = await listAuditActions(token, { limit: 100 });
    if (!isCancelled()) {
      setItems(response.items);
    }
  } catch (loadError) {
    if (!isCancelled()) {
      setError(
        loadError instanceof Error ? loadError.message : "加载审计日志失败"
      );
    }
  }
}
