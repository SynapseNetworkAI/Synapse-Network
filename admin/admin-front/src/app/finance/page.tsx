"use client";

import { useEffect, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  getFinanceOverview,
  listApprovals,
  type ApprovalItem,
  type FinanceOverview,
} from "@/services/admin-api";


export default function FinancePage() {
  const { admin, token, loading } = useAdminSession();
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    async function load() {
      try {
        const [finance, approvalQueue] = await Promise.all([
          getFinanceOverview(activeToken),
          listApprovals(activeToken, { limit: 8 }),
        ]);
        if (!cancelled) {
          setOverview(finance);
          setApprovals(approvalQueue.items.filter((item) => item.approvalType.includes("refund") || item.approvalType.includes("withdraw") || item.approvalType.includes("deposit")));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载资金运营模块失败");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || !admin || !overview) {
    return <main className="state-screen">正在同步资金运营视图...</main>;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Finance Admin"
      title="资金运营中心"
      description="围绕充值、退款、提现和账本偏差建立受控操作台，避免财务动作直接撞主交易库。"
    >
      {error ? <section className="panel"><p className="form-message form-message--error">{error}</p></section> : null}
      <section className="dashboard-section">
        <div className="dashboard-section__header">
          <div>
            <p className="panel__eyebrow">Finance Read Model</p>
            <h3 className="panel__title">稳定读模型快照</h3>
          </div>
          <span className="dashboard-section__stamp">{overview.projectedAt ?? "live"}</span>
        </div>
        <div className="dashboard-metric-grid">
          <article className="dashboard-mini-card"><p className="metric-card__label">今日充值</p><p className="dashboard-mini-card__value">{overview.todayDepositUsdc}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">今日退款</p><p className="dashboard-mini-card__value">{overview.todayRefundUsdc}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">待提现</p><p className="dashboard-mini-card__value">{overview.pendingWithdrawalCount}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">账本差额</p><p className="dashboard-mini-card__value">{overview.vaultLedgerDeltaUsdc}</p></article>
        </div>
      </section>
      <section className="panel panel--split">
        <article>
          <p className="panel__eyebrow">Controlled Actions</p>
          <h3 className="panel__title">受控动作入口</h3>
          <div className="catalog-list">
            {[
              ["充值异常定位", "定位 deposit intent 未入账、链上确认延迟和 backfill 回放问题。"],
              ["退款审批", "对接 refund_approve 审批命令，避免未复核直接出账。"],
              ["提现审核", "大额或高风险提现进入 /withdrawal-reviews 专用工作台，直接调用 review API 推进 approve / reject。"],
              ["冻结 / 解冻", "后续接受控 gateway 内部命令，不直接改资金真相表。"],
            ].map(([title, description]) => (
              <div key={title} className="catalog-card">
                <div className="catalog-card__header"><strong>{title}</strong></div>
                <p className="table-subtext">{description}</p>
              </div>
            ))}
          </div>
        </article>
        <article>
          <p className="panel__eyebrow">Finance Queue</p>
          <h3 className="panel__title">相关审批单</h3>
          <div className="queue">
            {approvals.map((item) => (
              <article key={item.approvalId} className="queue__item queue__item--stacked">
                <div className="queue__body">
                  <div>
                    <p className="queue__id">{item.approvalId}</p>
                    <h4>{item.approvalType}</h4>
                    <p className="queue__meta">{item.requesterRole} · {item.amountUsdc} USDC</p>
                  </div>
                  <span className="queue__status">{item.status}</span>
                </div>
              </article>
            ))}
          </div>
        </article>
      </section>
    </AdminShell>
  );
}