"use client";

import { useEffect, useState } from "react";

import {
  getReconciliationDetail,
  getReconciliationDrilldown,
  type ReconciliationDetail,
  type ReconciliationDrilldownResult,
} from "@/services/admin-api";

import type { DrilldownToken } from "./reconciliation-presenters";

export function useReconciliationDetail(token: string | null) {
  const [detail, setDetail] = useState<ReconciliationDetail | null>(null);
  const [drilldown, setDrilldown] =
    useState<ReconciliationDrilldownResult | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useReconciliationBootstrap({ token, setBootstrapping, setDetail, setError });

  return {
    bootstrapping,
    detail,
    drilldown,
    drilldownError,
    drilldownLoading,
    error,
    clearDrilldown: () => {
      setDrilldown(null);
      setDrilldownError(null);
    },
    loadDrilldown: (tokenConfig: DrilldownToken) =>
      loadReconciliationDrilldown({
        token,
        tokenConfig,
        setDrilldown,
        setDrilldownError,
        setDrilldownLoading,
      }),
  };
}

function useReconciliationBootstrap({
  token,
  setBootstrapping,
  setDetail,
  setError,
}: Readonly<{
  token: string | null;
  setBootstrapping: (value: boolean) => void;
  setDetail: (detail: ReconciliationDetail | null) => void;
  setError: (value: string | null) => void;
}>) {
  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    void loadReconciliationDetail({
      token,
      isCancelled: () => cancelled,
      setBootstrapping,
      setDetail,
      setError,
    });
    return () => {
      cancelled = true;
    };
  }, [setBootstrapping, setDetail, setError, token]);
}

async function loadReconciliationDetail({
  token,
  isCancelled,
  setBootstrapping,
  setDetail,
  setError,
}: Readonly<{
  token: string;
  isCancelled: () => boolean;
  setBootstrapping: (value: boolean) => void;
  setDetail: (detail: ReconciliationDetail | null) => void;
  setError: (value: string | null) => void;
}>) {
  try {
    const payload = await getReconciliationDetail(token);
    if (!isCancelled()) {
      setDetail(payload);
    }
  } catch (loadError) {
    if (!isCancelled()) {
      setError(
        loadError instanceof Error ? loadError.message : "加载对账详情失败"
      );
    }
  } finally {
    if (!isCancelled()) {
      setBootstrapping(false);
    }
  }
}

async function loadReconciliationDrilldown({
  token,
  tokenConfig,
  setDrilldown,
  setDrilldownError,
  setDrilldownLoading,
}: Readonly<{
  token: string | null;
  tokenConfig: DrilldownToken;
  setDrilldown: (value: ReconciliationDrilldownResult | null) => void;
  setDrilldownError: (value: string | null) => void;
  setDrilldownLoading: (value: boolean) => void;
}>) {
  if (!token) {
    return;
  }

  setDrilldownLoading(true);
  setDrilldownError(null);
  try {
    const payload = await getReconciliationDrilldown(token, {
      [tokenConfig.kind]: tokenConfig.value,
    });
    setDrilldown(payload);
  } catch (loadError) {
    setDrilldownError(
      loadError instanceof Error ? loadError.message : "加载交叉定位结果失败"
    );
  } finally {
    setDrilldownLoading(false);
  }
}
