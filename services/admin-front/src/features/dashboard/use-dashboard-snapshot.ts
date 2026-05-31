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

type DashboardSnapshotSettled = {
  overview: DashboardOverview | null;
  systemStatus: SystemStatus | null;
  financeOverview: FinanceOverview | null;
  operationsOverview: OperationsOverview | null;
  reconciliationDetail: ReconciliationDetail | null;
  approvals: ApprovalItem[];
  error: string | null;
};

function resolveDashboardSnapshotSettled(
  results: [
    PromiseSettledResult<DashboardOverview>,
    PromiseSettledResult<SystemStatus>,
    PromiseSettledResult<FinanceOverview>,
    PromiseSettledResult<OperationsOverview>,
    PromiseSettledResult<ReconciliationDetail>,
    PromiseSettledResult<{ items: ApprovalItem[] }>,
  ],
): DashboardSnapshotSettled {
  const [overviewResult, systemStatusResult, financeResult, operationsResult, reconciliationResult, approvalsResult] = results;
  const overview = overviewResult.status === "fulfilled" ? overviewResult.value : null;
  const systemStatus = systemStatusResult.status === "fulfilled" ? systemStatusResult.value : null;
  const financeOverview = financeResult.status === "fulfilled" ? financeResult.value : null;
  const operationsOverview = operationsResult.status === "fulfilled" ? operationsResult.value : null;
  const reconciliationDetail = reconciliationResult.status === "fulfilled" ? reconciliationResult.value : null;
  const approvals = approvalsResult.status === "fulfilled" ? approvalsResult.value.items : [];
  const successfulCoreLoads = [overview, systemStatus, financeOverview, operationsOverview, reconciliationDetail].filter(Boolean).length;
  const firstRejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  return {
    overview,
    systemStatus,
    financeOverview,
    operationsOverview,
    reconciliationDetail,
    approvals,
    error:
      successfulCoreLoads > 0
        ? null
        : firstRejected?.reason instanceof Error
          ? firstRejected.reason.message
          : "加载控制台快照失败",
  };
}

export { resolveDashboardSnapshotSettled };

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
        const settled = await Promise.allSettled([
          getDashboardOverview(activeToken),
          getSystemStatus(activeToken),
          getFinanceOverview(activeToken),
          getOperationsOverview(activeToken),
          getReconciliationDetail(activeToken),
          includeApprovals ? listApprovals(activeToken, { limit: approvalsLimit }) : Promise.resolve({ items: [] }),
          refreshDiagnostics(activeToken, { silent: true }),
        ]) as [
          PromiseSettledResult<DashboardOverview>,
          PromiseSettledResult<SystemStatus>,
          PromiseSettledResult<FinanceOverview>,
          PromiseSettledResult<OperationsOverview>,
          PromiseSettledResult<ReconciliationDetail>,
          PromiseSettledResult<{ items: ApprovalItem[] }>,
          PromiseSettledResult<unknown>,
        ];

        if (cancelled) {
          return;
        }

        const resolved = resolveDashboardSnapshotSettled([
          settled[0],
          settled[1],
          settled[2],
          settled[3],
          settled[4],
          settled[5],
        ]);

        setOverview(resolved.overview);
        setSystemStatus(resolved.systemStatus);
        setFinanceOverview(resolved.financeOverview);
        setOperationsOverview(resolved.operationsOverview);
        setReconciliationDetail(resolved.reconciliationDetail);
        setApprovals(resolved.approvals);
        setError(resolved.error);
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
