"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ApprovalQueue } from "@/features/approval/approval-queue";
import { ReviewWorkbench } from "@/features/withdrawal-reviews/review-workbench";
import { useProviderWithdrawReviews } from "@/features/withdrawal-reviews/use-provider-withdraw-reviews";
import { useAdminSession } from "@/lib/use-admin-session";
import { listApprovals, type ApprovalItem } from "@/services/admin-api";

export default function ApprovalsPage() {
  const { admin, token, loading } = useAdminSession();
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const {
    items: withdrawReviewItems,
    activeReviewId,
    decisionNote,
    message,
    error: withdrawError,
    isPending,
    metrics,
    setActiveReviewId,
    setDecisionNote,
    setMessage,
    handleDecision,
  } = useProviderWithdrawReviews(token);
  const canDecide = admin?.permissions.includes("approval:decide") ?? false;

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
        setApprovalError(loadError instanceof Error ? loadError.message : "加载审批列表失败");
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

  return (
    <AdminShell
      admin={admin}
      eyebrow="Approval Workflow"
      title="审批中心"
      description="高风险财务和配置动作必须经过多级审批，执行人和审批人保持职责分离；提现人工审核同时在这里形成总览队列。"
    >
      {approvalError ? <section className="panel"><p className="form-message form-message--error">{approvalError}</p></section> : null}
      {withdrawError ? <section className="panel"><p className="form-message form-message--error">{withdrawError}</p></section> : null}
      {message ? <section className="panel"><p className="form-message form-message--success">{message}</p></section> : null}
      <ApprovalQueue items={items} />

      <section className="dashboard-section">
        <div className="dashboard-section__header">
          <div>
            <p className="panel__eyebrow">Manual Review Bridge</p>
            <h3 className="panel__title">提现审核总览队列</h3>
            <p className="panel__text">专用工作台负责深度核验，这里同步展示 provider manual review，并允许 reviewer 直接完成 approve / reject。</p>
          </div>
          <span className="dashboard-section__stamp">{metrics.pendingCount} manual reviews</span>
        </div>
        <div className="dashboard-metric-grid">
          <article className="dashboard-mini-card"><p className="metric-card__label">待审单数</p><p className="dashboard-mini-card__value">{metrics.pendingCount}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">待审总额</p><p className="dashboard-mini-card__value">{metrics.totalAmount}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">Red Risk</p><p className="dashboard-mini-card__value">{metrics.redCount}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">Yellow Risk</p><p className="dashboard-mini-card__value">{metrics.yellowCount}</p></article>
        </div>
      </section>

      <ReviewWorkbench
        items={withdrawReviewItems}
        activeReviewId={activeReviewId}
        canDecide={canDecide}
        decisionNote={decisionNote}
        isPending={isPending}
        onSelect={(withdrawalId) => {
          setActiveReviewId(withdrawalId);
          setDecisionNote("");
          setMessage(null);
        }}
        onDecisionNoteChange={setDecisionNote}
        onDecision={handleDecision}
      />

      <section className="panel panel--split">
        <article>
          <p className="panel__eyebrow">Flow Rules</p>
          <h3 className="panel__title">审批分级</h3>
          <p className="panel__text">
            读取权限与审批提交权限已分离，真正的审批决策权限只授予 reviewer 角色。
          </p>
        </article>
        <article>
          <p className="panel__eyebrow">Dual View</p>
          <h3 className="panel__title">总览队列 + 专用工作台</h3>
          <p className="panel__text">
            审批中心承担统一入口和跨域排班，提现审核页保留完整上下文与深度核验视图。两页共享同一套 review API 和动作校验。
          </p>
          <Link href="/withdrawal-reviews" className="button button--secondary approvals-link-button">打开提现审核专用工作台</Link>
        </article>
      </section>
    </AdminShell>
  );
}
