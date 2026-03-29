"use client";

import { useEffect, useMemo, useState } from "react";

import { useDiagnosticsSnapshot } from "@/lib/use-diagnostics-snapshot";
import {
  getDashboardOverview,
  getFinanceOverview,
  getOperationsOverview,
  getReconciliationDetail,
  getSystemStatus,
  listApprovals,
  type ApprovalItem,
  type DashboardOverview,
  type FinanceOverview,
  type OperationsOverview,
  type ReconciliationDetail,
  type SystemStatus,
} from "@/services/admin-api";

type UseDashboardSnapshotOptions = {
  approvalsLimit?: number;
  includeApprovals?: boolean;
};

export function useDashboardSnapshot(
  token: string | null | undefined,
  options?: UseDashboardSnapshotOptions,
) {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [financeOverview, setFinanceOverview] = useState<FinanceOverview | null>(null);
  const [operationsOverview, setOperationsOverview] = useState<OperationsOverview | null>(null);
  const [reconciliationDetail, setReconciliationDetail] = useState<ReconciliationDetail | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const {
    diagnostics,
    diagnosticError,
    diagnosticsLoading,
    refreshDiagnostics,
  } = useDiagnosticsSnapshot(token, {
    suppressInitialLoading: true,
    loadErrorMessage: "加载系统诊断失败",
  });

  const approvalsLimit = useMemo(() => options?.approvalsLimit ?? 8, [options?.approvalsLimit]);
  const includeApprovals = options?.includeApprovals ?? true;

  useEffect(() => {
    if (!token) {
      return;
    }

    const activeToken = token;
    let cancelled = false;
    setBootstrapping(true);

    async function load() {
      try {
        const [dashboardOverview, status, finance, operations, reconciliation, approvalQueue] = await Promise.all([
          getDashboardOverview(activeToken),
          getSystemStatus(activeToken),
          getFinanceOverview(activeToken),
          getOperationsOverview(activeToken),
          getReconciliationDetail(activeToken),
          includeApprovals ? listApprovals(activeToken, { limit: approvalsLimit }) : Promise.resolve({ items: [] }),
          refreshDiagnostics(activeToken, { silent: true }),
        ]);

        if (cancelled) {
          return;
        }

        setOverview(dashboardOverview);
        setSystemStatus(status);
        setFinanceOverview(finance);
        setOperationsOverview(operations);
        setReconciliationDetail(reconciliation);
        setApprovals(approvalQueue.items);
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载控制台快照失败");
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
  }, [approvalsLimit, includeApprovals, refreshDiagnostics, token]);

  return {
    overview,
    systemStatus,
    financeOverview,
    operationsOverview,
    reconciliationDetail,
    approvals,
    diagnostics,
    diagnosticError,
    diagnosticsLoading,
    refreshDiagnostics,
    bootstrapping,
    error,
  };
}