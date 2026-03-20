"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ReviewWorkbench } from "@/features/withdrawal-reviews/review-workbench";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  decideProviderWithdrawReview,
  listProviderWithdrawReviews,
  type ProviderWithdrawReviewItem,
} from "@/services/admin-api";


export default function WithdrawalReviewsPage() {
  const { admin, token, loading } = useAdminSession();
  const [items, setItems] = useState<ProviderWithdrawReviewItem[]>([]);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function refreshReviews(activeToken: string) {
    const reviewQueue = await listProviderWithdrawReviews(activeToken, { limit: 20 });
    setItems(reviewQueue.items);
    setActiveReviewId((current) => {
      if (current && reviewQueue.items.some((item) => item.withdrawalId === current)) {
        return current;
      }
      return reviewQueue.items[0]?.withdrawalId ?? null;
    });
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;

    async function load() {
      try {
        const reviewQueue = await listProviderWithdrawReviews(activeToken, { limit: 20 });
        if (cancelled) {
          return;
        }
        setItems(reviewQueue.items);
        setActiveReviewId(reviewQueue.items[0]?.withdrawalId ?? null);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载提现审核队列失败");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const canDecide = admin?.permissions.includes("approval:decide") ?? false;
  const metrics = useMemo(() => {
    const totalAmount = items.reduce((sum, item) => sum + Number(item.amountUsdc || 0), 0);
    const redCount = items.filter((item) => item.riskLevel === "red").length;
    const yellowCount = items.filter((item) => item.riskLevel === "yellow").length;
    return {
      pendingCount: items.length,
      totalAmount: totalAmount.toFixed(2),
      redCount,
      yellowCount,
    };
  }, [items]);

  function handleDecision(decision: "APPROVE" | "REJECT") {
    if (!token || !activeReviewId) {
      return;
    }
    const note = decisionNote.trim();
    if (decision === "REJECT" && !note) {
      setError("Reject 需要 reviewer note，避免审计链路只剩一个状态码。\n");
      return;
    }
    const activeToken = token;
    startTransition(async () => {
      try {
        const result = await decideProviderWithdrawReview(activeToken, activeReviewId, {
          decision,
          note,
        });
        setMessage(`${result.reviewDecision} -> ${result.status}${result.message ? ` · ${result.message}` : ""}`);
        setError(null);
        setDecisionNote("");
        await refreshReviews(activeToken);
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "提交提现审核动作失败");
      }
    });
  }

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