"use client";

import { AdminShell } from "@/components/admin-shell";
import { ReviewWorkbench } from "@/features/withdrawal-reviews/review-workbench";
import { useProviderWithdrawReviews } from "@/features/withdrawal-reviews/use-provider-withdraw-reviews";
import { useAdminSession } from "@/lib/use-admin-session";


export default function WithdrawalReviewsPage() {
  const { admin, token, loading } = useAdminSession();
  const {
    items,
    activeReviewId,
    decisionNote,
    message,
    error,
    isPending,
    metrics,
    setActiveReviewId,
    setDecisionNote,
    setMessage,
    handleDecision,
  } = useProviderWithdrawReviews(token);
  const canDecide = admin?.permissions.includes("approval:decide") ?? false;

  if (loading || !admin) {
    return <main className="state-screen">正在同步提现审核工作台...</main>;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Withdrawal Reviews"
      title="提现审核工作台"
      description="专门处理 provider withdrawal 的人工审核队列，不再把 manual review 挤进泛审批列表里丢上下文。"
    >
      {error ? <section className="panel"><p className="form-message form-message--error">{error}</p></section> : null}
      {message ? <section className="panel"><p className="form-message form-message--success">{message}</p></section> : null}

      <section className="dashboard-section">
        <div className="dashboard-section__header">
          <div>
            <p className="panel__eyebrow">Manual Review Snapshot</p>
            <h3 className="panel__title">当前人工审核负载</h3>
            <p className="panel__text">高风险提现会先冻结在 provider frozen，直到 reviewer 明确 approve / reject。</p>
          </div>
          <span className="dashboard-section__stamp">approval:read {canDecide ? "+ approval:decide" : "only"}</span>
        </div>
        <div className="dashboard-metric-grid">
          <article className="dashboard-mini-card"><p className="metric-card__label">待审单数</p><p className="dashboard-mini-card__value">{metrics.pendingCount}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">待审总额</p><p className="dashboard-mini-card__value">{metrics.totalAmount}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">Red Risk</p><p className="dashboard-mini-card__value">{metrics.redCount}</p></article>
          <article className="dashboard-mini-card"><p className="metric-card__label">Yellow Risk</p><p className="dashboard-mini-card__value">{metrics.yellowCount}</p></article>
        </div>
      </section>

      <ReviewWorkbench
        items={items}
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
    </AdminShell>
  );
}