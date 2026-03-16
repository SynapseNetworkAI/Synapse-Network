"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AdminShell } from "@/components/admin-shell";
import { AdminStatus } from "@/components/admin-status";
import { SummaryCards } from "@/features/dashboard/summary-cards";
import { clearAdminSession, readAdminProfile, readAdminToken } from "@/lib/admin-session";
import { getCurrentAdmin, getDashboardOverview, getSystemStatus, type AdminProfile, type DashboardOverview, type SystemStatus } from "@/services/admin-api";

export default function DashboardPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
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
        const [profile, dashboardOverview, status] = await Promise.all([
          getCurrentAdmin(accessToken),
          getDashboardOverview(accessToken),
          getSystemStatus(accessToken),
        ]);
        if (cancelled) {
          return;
        }
        setAdmin(profile);
        setOverview(dashboardOverview);
        setSystemStatus(status);
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

  if (!admin || !overview) {
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
      <section className="panel panel--split">
        <article>
          <p className="panel__eyebrow">Finance Ops</p>
          <h3 className="panel__title">充值异常处理</h3>
          <p className="panel__text">
            当前已接入 `gateway-admin` 的总览指标，下一步直接挂接充值异常列表和回放任务入口。
          </p>
        </article>
        <article>
          <p className="panel__eyebrow">Risk & Audit</p>
          <h3 className="panel__title">敏感动作留痕</h3>
          <p className="panel__text">
            `gateway-admin` 现在已统一返回 requestId 与错误模型，后续审计检索可直接按请求链路查询。
          </p>
        </article>
      </section>
    </AdminShell>
  );
}
