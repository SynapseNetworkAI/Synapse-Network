"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ApprovalQueue } from "@/features/approval/approval-queue";
import { useAdminSession } from "@/lib/use-admin-session";
import { listApprovals, type ApprovalItem } from "@/services/admin-api";

export default function ApprovalsPage() {
  const { admin, token, loading } = useAdminSession();
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;

    let cancelled = false;

    async function load() {
      try {
        const approvals = await listApprovals(activeToken);
        if (cancelled) {
          return;
        }
        setItems(approvals.items);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载审批列表失败");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || !admin) {
    return <main className="state-screen">正在读取审批队列...</main>;
  }

  const projectedWithdrawReviewItems = items.filter((item) => item.approvalType === "provider_withdraw_review");
  const projectedWithdrawAmount = projectedWithdrawReviewItems
    .reduce((sum, item) => sum + Number(item.amountUsdc || 0), 0)
    .toFixed(2);
  const projectedWithdrawRed = projectedWithdrawReviewItems.filter((item) => item.approvalLevel === "L3").length;
  const projectedWithdrawYellow = projectedWithdrawReviewItems.filter((item) => item.approvalLevel === "L2").length;

  return (
    <AdminShell
      admin={admin}
      eyebrow="Approval Workflow"
      title="审批中心"
      description="高风险财务和配置动作必须经过多级审批，执行人和审批人保持职责分离；provider manual review 现在直接投影进统一审批队列。"
    >
      {error ? <section className="panel"><p className="form-message form-message--error">{error}</p></section> : null}
      <ApprovalQueue items={items} />

      <section className="dashboard-section">
        <div className="dashboard-section__header">
          <div>
            <p className="panel__eyebrow">Unified Projection</p>
            <h3 className="panel__title">Provider Manual Review 已合流</h3>
            <p className="panel__text">`/api/admin/v1/approvals` 现在直接投影 provider manual review，所以审批中心顶部队列已经是真正的统一入口，不再需要额外并排一份提现队列。</p>
          </div>
          <span className="dashboard-section__stamp">{projectedWithdrawReviewItems.length} projected reviews</span>
        </div>
        <div className="dashboard-metric-grid">
          <article className="dashboard-mini-card"><p className="metric-card__label">Projected Reviews</p><p className="dashboard-mini-card__value">{projectedWithdrawReviewItems.length}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">Projected Amount</p><p className="dashboard-mini-card__value">{projectedWithdrawAmount}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">L3 Reviews</p><p className="dashboard-mini-card__value">{projectedWithdrawRed}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">L2 Reviews</p><p className="dashboard-mini-card__value">{projectedWithdrawYellow}</p></article>
        </div>
      </section>

      <section className="panel panel--split">
        <article>
          <p className="panel__eyebrow">Flow Rules</p>
          <h3 className="panel__title">审批分级</h3>
          <p className="panel__text">
            读取权限与审批提交权限已分离，真正的审批决策权限只授予 reviewer 角色。对 provider manual review 来说，统一审批队列现在展示的是投影项，不是独立持久化 approval 行。
          </p>
        </article>
        <article>
          <p className="panel__eyebrow">Deep Review</p>
          <h3 className="panel__title">深度核验仍走专用工作台</h3>
          <p className="panel__text">
            统一队列解决排班和总览；需要 evidence summary、风险原因和明确 reviewer note 时，继续跳到提现审核专用工作台处理。
          </p>
          <Link href="/withdrawal-reviews" className="button button--secondary approvals-link-button">打开提现审核专用工作台</Link>
        </article>
      </section>
    </AdminShell>
  );
}
