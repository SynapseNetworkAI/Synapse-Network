"use client";

import { useEffect, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { AdminStatus } from "@/components/admin-status";
import { SummaryCards } from "@/features/dashboard/summary-cards";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  getActivityTrends,
  getDashboardOverview,
  getFinanceOverview,
  getOperationsOverview,
  getSystemStatus,
  type ActivityTrendSeries,
  type DashboardOverview,
  type FinanceOverview,
  type OperationsOverview,
  type SystemStatus,
} from "@/services/admin-api";
import { ActivityTrendPanel } from "../../features/dashboard/activity-trend-panel";
import { FinanceOverviewPanel } from "../../features/dashboard/finance-overview-panel";
import { OperationsOverviewPanel } from "../../features/dashboard/operations-overview-panel";

export default function DashboardPage() {
  const { admin, token, loading } = useAdminSession();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [financeOverview, setFinanceOverview] = useState<FinanceOverview | null>(null);
  const [activityTrends, setActivityTrends] = useState<ActivityTrendSeries | null>(null);
  const [operationsOverview, setOperationsOverview] = useState<OperationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !admin) {
      return;
    }
    const activeToken = token;

    let cancelled = false;

    async function load() {
      try {
        const [dashboardOverview, status, finance, trends, operations] = await Promise.all([
          getDashboardOverview(activeToken),
          getSystemStatus(activeToken),
          getFinanceOverview(activeToken),
          getActivityTrends(activeToken),
          getOperationsOverview(activeToken),
        ]);
        if (cancelled) {
          return;
        }
        setOverview(dashboardOverview);
        setSystemStatus(status);
        setFinanceOverview(finance);
        setActivityTrends(trends);
        setOperationsOverview(operations);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载控制台失败");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [admin, token]);

  if (loading) {
    return <main className="state-screen">正在连接 gateway-admin 控制面...</main>;
  }

  if (!admin) {
    return null;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Operations Overview"
      title="管理员控制台"
      description="把审批、财务异常排查、审计告警汇聚到单一入口，后续通过 gateway-admin 聚合只读指标与受控动作。"
    >
      <AdminStatus admin={admin} status={systemStatus} />
      {error ? <section className="panel"><p className="form-message form-message--error">{error}</p></section> : null}
      {overview ? <SummaryCards metrics={overview.metrics} /> : null}
      <div className="dashboard-stack">
        {financeOverview ? <FinanceOverviewPanel overview={financeOverview} /> : null}
        {activityTrends ? <ActivityTrendPanel trends={activityTrends} /> : null}
        {operationsOverview ? <OperationsOverviewPanel overview={operationsOverview} /> : null}
      </div>
    </AdminShell>
  );
}
