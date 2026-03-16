"use client";

import { useEffect, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  getOperationsOverview,
  getSystemStatus,
  type OperationsOverview,
  type SystemStatus,
} from "@/services/admin-api";


export default function SystemPage() {
  const { admin, token, loading } = useAdminSession();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [operations, setOperations] = useState<OperationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    async function load() {
      try {
        const [systemStatus, operationsOverview] = await Promise.all([
          getSystemStatus(activeToken),
          getOperationsOverview(activeToken),
        ]);
        if (!cancelled) {
          setStatus(systemStatus);
          setOperations(operationsOverview);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载系统运维模块失败");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || !admin || !status || !operations) {
    return <main className="state-screen">正在同步系统运行状态...</main>;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="System Control"
      title="系统运维中心"
      description="把 gateway、indexer、backfill 与 reconciliation 的运行时快照统一折叠进控制面。"
    >
      {error ? <section className="panel"><p className="form-message form-message--error">{error}</p></section> : null}
      <section className="dashboard-section">
        <div className="dashboard-section__header">
          <div>
            <p className="panel__eyebrow">Runtime Status</p>
            <h3 className="panel__title">服务健康与补偿状态</h3>
          </div>
          <span className="dashboard-section__stamp">queue depth {status.approvalQueueDepth}</span>
        </div>
        <div className="dashboard-ops-grid">
          <article className="dashboard-mini-card"><p className="metric-card__label">Gateway Admin</p><p className="dashboard-mini-card__value">{status.gatewayAdmin}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">Gateway</p><p className="dashboard-mini-card__value">{status.gateway}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">Indexer Last Processed</p><p className="dashboard-mini-card__value">{operations.indexerLastProcessedAt ?? "n/a"}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">Reconciliation Delta</p><p className="dashboard-mini-card__value">{operations.reconciliationDeltaUsdc}</p></article>
        </div>
      </section>
      <section className="panel panel--split">
        <article>
          <p className="panel__eyebrow">Runtime Snapshot</p>
          <h3 className="panel__title">补偿与对账</h3>
          <div className="catalog-list">
            {[
              ["backfillLastScanAt", operations.backfillLastScanAt ?? "n/a"],
              ["backfillLastScannedBlock", String(operations.backfillLastScannedBlock ?? "n/a")],
              ["recentGatewayFailures", String(operations.recentGatewayFailures)],
              ["recentAuditAlerts", String(operations.recentAuditAlerts)],
            ].map(([label, value]) => (
              <div key={label} className="catalog-card">
                <div className="catalog-card__header"><strong>{label}</strong></div>
                <p className="table-subtext">{value}</p>
              </div>
            ))}
          </div>
        </article>
        <article>
          <p className="panel__eyebrow">Guardrails</p>
          <h3 className="panel__title">受控系统操作</h3>
          <div className="catalog-list">
            {[
              ["gateway 健康检查", "健康检查展示只读快照，不把内部依赖细节暴露给浏览器。"],
              ["indexer 状态", "只展示已持久化 runtime state，不直连进程内内存。"],
              ["reconciliation 告警", "出现 vault delta 或 last error 时升级成显式告警。"],
              ["配置中心", "费率、阈值和服务注册应通过审批命令修改，而不是直接写库。"],
            ].map(([title, description]) => (
              <div key={title} className="catalog-card">
                <div className="catalog-card__header"><strong>{title}</strong></div>
                <p className="table-subtext">{description}</p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </AdminShell>
  );
}