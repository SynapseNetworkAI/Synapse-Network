"use client";

import { useEffect, useState } from "react";

import { filterFinanceApprovals } from "@/features/finance/finance-presenters";
import {
  getActivityTrends,
  getFinanceOverview,
  getReconciliationDetail,
  listApprovals,
  type ActivityTrendPoint,
  type ApprovalItem,
  type FinanceOverview,
  type ReconciliationDetail,
} from "@/services/admin-api";

export function useFinancePageData(token: string | null) {
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [reconciliationDetail, setReconciliationDetail] =
    useState<ReconciliationDetail | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [trendPoints, setTrendPoints] = useState<ActivityTrendPoint[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    const activeToken = token;
    let cancelled = false;

    async function load() {
      try {
        const [finance, reconciliation, approvalQueue, activityTrends] =
          await Promise.all([
            getFinanceOverview(activeToken),
            getReconciliationDetail(activeToken),
            listApprovals(activeToken, { limit: 12 }),
            getActivityTrends(activeToken),
          ]);

        if (cancelled) {
          return;
        }
        setOverview(finance);
        setReconciliationDetail(reconciliation);
        setApprovals(filterFinanceApprovals(approvalQueue.items));
        setTrendPoints(activityTrends.points);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "加载资金运营模块失败"
          );
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return {
    approvals,
    bootstrapping,
    error,
    overview,
    reconciliationDetail,
    trendPoints,
  };
}
