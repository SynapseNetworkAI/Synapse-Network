"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AdminShell } from "@/components/admin-shell";
import { AdminStatus } from "@/components/admin-status";
import { SummaryCards } from "@/features/dashboard/summary-cards";
import { clearAdminSession, readAdminProfile, readAdminToken } from "@/lib/admin-session";
import {
  getActivityTrends,
  getCurrentAdmin,
  getDashboardOverview,
  getFinanceOverview,
  getOperationsOverview,
  getSystemStatus,
  type ActivityTrendSeries,
  type AdminProfile,
  type DashboardOverview,
  type FinanceOverview,
  type OperationsOverview,
  type SystemStatus,
} from "@/services/admin-api";
import { ActivityTrendPanel } from "../../features/dashboard/activity-trend-panel";
import { FinanceOverviewPanel } from "../../features/dashboard/finance-overview-panel";
import { OperationsOverviewPanel } from "../../features/dashboard/operations-overview-panel";

export default function DashboardPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [financeOverview, setFinanceOverview] = useState<FinanceOverview | null>(null);
  const [activityTrends, setActivityTrends] = useState<ActivityTrendSeries | null>(null);
  const [operationsOverview, setOperationsOverview] = useState<OperationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = readAdminToken();
    const cachedProfile = readAdminProfile();
    if (!token) {
      router.replace("/login");
      return;
    }
    const accessToken = token;
    if (cachedProfile) {
      setAdmin(cachedProfile);
    }

    let cancelled = false;

    async function load() {
      try {
        const [profile, dashboardOverview, status, finance, trends, operations] = await Promise.all([
          getCurrentAdmin(accessToken),
          getDashboardOverview(accessToken),
          getSystemStatus(accessToken),
          getFinanceOverview(accessToken),
          getActivityTrends(accessToken),
          getOperationsOverview(accessToken),
        ]);
        if (cancelled) {
          return;
        }
        setAdmin(profile);
        setOverview(dashboardOverview);
        setSystemStatus(status);
        setFinanceOverview(finance);
        setActivityTrends(trends);
        setOperationsOverview(operations);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        clearAdminSession();
        setError(loadError instanceof Error ? loadError.message : "加载控制台失败");
        router.replace("/login");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!admin || !overview || !financeOverview || !activityTrends || !operationsOverview) {
    return <main className="state-screen">正在连接 gateway-admin 控制面...</main>;
  }

  return (
    <AdminShell
      eyebrow="Operations Overview"
      title="管理员控制台"
      description="把审批、财务异常排查、审计告警汇聚到单一入口，后续通过 gateway-admin 聚合只读指标与受控动作。"
    >
      <AdminStatus admin={admin} status={systemStatus} />
      {error ? <section className="panel"><p className="form-message form-message--error">{error}</p></section> : null}
      <SummaryCards metrics={overview.metrics} />
      <div className="dashboard-stack">
        <FinanceOverviewPanel overview={financeOverview} />
        <ActivityTrendPanel trends={activityTrends} />
        <OperationsOverviewPanel overview={operationsOverview} />
      </div>
    </AdminShell>
  );
}
