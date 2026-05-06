"use client";

import type { ProviderWithdrawReviewItem } from "@/services/admin-api";
import { canSubmitWithdrawReviewDecision } from "@/features/withdrawal-reviews/review-action-feedback";

type ReviewWorkbenchProps = {
  items: ProviderWithdrawReviewItem[];
  activeReviewId: string | null;
  canDecide: boolean;
  decisionNote: string;
  isPending: boolean;
  onSelect: (withdrawalId: string) => void;
  onDecisionNoteChange: (value: string) => void;
  onDecision: (decision: "APPROVE" | "REJECT") => void;
};

function riskTone(level: string | null): string {
  if (level === "red") {
    return "status-pill status-pill--alert";
  }
  if (level === "yellow") {
    return "status-pill status-pill--degraded";
  }
  return "status-pill status-pill--healthy";
}

function ReviewQueue({
  items,
  activeWithdrawalId,
  onSelect,
}: Readonly<{
  items: ProviderWithdrawReviewItem[];
  activeWithdrawalId: string | null;
  onSelect: (withdrawalId: string) => void;
}>) {
  if (!items.length) {
    return (
      <div className="empty-state">
        <strong>当前没有待审核提现单</strong>
        <p className="panel__text">
          gateway 已经清空人工审核队列，新的高风险提现出现后会自动进入这里。
        </p>
      </div>
    );
  }

  return (
    <div className="queue review-list">
      {items.map((item) => {
        const isActive = item.withdrawalId === activeWithdrawalId;
        return (
          <button
            key={item.withdrawalId}
            type="button"
            className={`queue__item queue__item--stacked review-list__button${
              isActive ? " queue__item--active" : ""
            }`}
            onClick={() => onSelect(item.withdrawalId)}
          >
            <div className="queue__body">
              <div>
                <p className="queue__id">{item.withdrawalId}</p>
                <h4>{item.ownerAddress}</h4>
                <p className="queue__meta">
                  {item.amountUsdc} USDC ·{" "}
                  {item.requestId ?? "request id pending"}
                </p>
              </div>
              <div className="pill-row">
                <span className={riskTone(item.riskLevel)}>
                  {item.riskLevel ?? "unknown"}
                </span>
                <span className="queue__status">{item.status}</span>
              </div>
            </div>
            <div className="queue__body queue__body--secondary">
              <p className="table-subtext">
                {item.riskReasonCode ?? "manual review"}
              </p>
              <p className="table-subtext">
                {item.createdAt ?? "time pending"}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ReviewDetail({
  activeReview,
  canDecide,
  decisionNote,
  isPending,
  canSubmitActiveDecision,
  onDecisionNoteChange,
  onDecision,
}: Readonly<{
  activeReview: ProviderWithdrawReviewItem | null;
  canDecide: boolean;
  decisionNote: string;
  isPending: boolean;
  canSubmitActiveDecision: boolean;
  onDecisionNoteChange: (value: string) => void;
  onDecision: (decision: "APPROVE" | "REJECT") => void;
}>) {
  if (!activeReview) {
    return (
      <div className="empty-state">
        <strong>没有可展示的审核详情</strong>
        <p className="panel__text">
          队列为空时，这里只保留审核动作说明和语义基线。
        </p>
      </div>
    );
  }

  return (
    <div className="module-stack">
      <ReviewSummaryCards activeReview={activeReview} />
      <ReviewEvidenceSummary activeReview={activeReview} />
      <ReviewActionPanel
        canDecide={canDecide}
        decisionNote={decisionNote}
        isPending={isPending}
        canSubmitActiveDecision={canSubmitActiveDecision}
        onDecisionNoteChange={onDecisionNoteChange}
        onDecision={onDecision}
      />
    </div>
  );
}

function ReviewSummaryCards({
  activeReview,
}: Readonly<{ activeReview: ProviderWithdrawReviewItem }>) {
  return (
    <div className="review-detail-grid">
      <div className="dashboard-mini-card review-kv">
        <p className="metric-card__label">Owner</p>
        <p className="dashboard-mini-card__value review-kv__value">
          {activeReview.ownerAddress}
        </p>
      </div>
      <div className="dashboard-mini-card review-kv">
        <p className="metric-card__label">Amount</p>
        <p className="dashboard-mini-card__value review-kv__value">
          {activeReview.amountUsdc}
        </p>
      </div>
      <div className="dashboard-mini-card review-kv">
        <p className="metric-card__label">Risk Code</p>
        <p className="dashboard-mini-card__value review-kv__value">
          {activeReview.riskReasonCode ?? "manual_review"}
        </p>
      </div>
      <div className="dashboard-mini-card review-kv">
        <p className="metric-card__label">Created</p>
        <p className="dashboard-mini-card__value review-kv__value">
          {activeReview.createdAt ?? "n/a"}
        </p>
      </div>
    </div>
  );
}

function ReviewEvidenceSummary({
  activeReview,
}: Readonly<{ activeReview: ProviderWithdrawReviewItem }>) {
  return (
    <div className="catalog-card review-detail-card">
      <div className="catalog-card__header">
        <strong>Evidence Summary</strong>
        <span className={riskTone(activeReview.riskLevel)}>
          {activeReview.riskLevel ?? "unknown"}
        </span>
      </div>
      <p className="table-subtext">
        {activeReview.evidenceSummary ??
          activeReview.message ??
          "Gateway did not persist an evidence summary for this withdrawal."}
      </p>
      <div className="pill-row review-detail-pills">
        {activeReview.requestId ? (
          <span className="permission-chip">
            request {activeReview.requestId}
          </span>
        ) : null}
        {activeReview.txHash ? (
          <span className="permission-chip">tx {activeReview.txHash}</span>
        ) : null}
        <span className="permission-chip">status {activeReview.status}</span>
      </div>
    </div>
  );
}

function ReviewActionPanel({
  canDecide,
  decisionNote,
  isPending,
  canSubmitActiveDecision,
  onDecisionNoteChange,
  onDecision,
}: Readonly<{
  canDecide: boolean;
  decisionNote: string;
  isPending: boolean;
  canSubmitActiveDecision: boolean;
  onDecisionNoteChange: (value: string) => void;
  onDecision: (decision: "APPROVE" | "REJECT") => void;
}>) {
  return (
    <div className="panel review-action-panel">
      <div>
        <p className="panel__eyebrow">Reviewer Note</p>
        <h4 className="panel__title review-action-panel__title">审核备注</h4>
        <p className="panel__text">
          拒绝时建议明确写出风控依据，批准时写明核验结论，便于审计回放。
        </p>
      </div>
      <form
        className="admin-form review-action-form"
        onSubmit={(event) => event.preventDefault()}
      >
        <label>
          <span>Reviewer Note</span>
          <textarea
            value={decisionNote}
            onChange={(event) => onDecisionNoteChange(event.target.value)}
            placeholder="Record the verification result, risk rationale, or escalation notes."
            rows={5}
          />
        </label>
        <div className="review-action-panel__footer">
          {canDecide ? null : (
            <p className="form-message form-message--error">
              当前会话只有读取权限，不能执行 approve / reject。
            </p>
          )}
          <div className="review-action-panel__buttons">
            <button
              type="button"
              className="button button--secondary"
              disabled={!canSubmitActiveDecision}
              onClick={() => onDecision("REJECT")}
            >
              {isPending ? "处理中..." : "Reject & Release"}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={!canSubmitActiveDecision}
              onClick={() => onDecision("APPROVE")}
            >
              {isPending ? "处理中..." : "Approve & Issue Ticket"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function ReviewWorkbench({
  items,
  activeReviewId,
  canDecide,
  decisionNote,
  isPending,
  onSelect,
  onDecisionNoteChange,
  onDecision,
}: Readonly<ReviewWorkbenchProps>) {
  const activeReview =
    items.find((item) => item.withdrawalId === activeReviewId) ??
    items[0] ??
    null;
  const canSubmitActiveDecision = canSubmitWithdrawReviewDecision({
    canDecide,
    isPending,
    status: activeReview?.status,
  });

  return (
    <section className="panel panel--split review-layout">
      <article>
        <div className="panel__header">
          <div>
            <p className="panel__eyebrow">Pending Queue</p>
            <h3 className="panel__title">待审核 Provider 提现</h3>
            <p className="panel__text">
              只展示仍处于 PENDING_MANUAL_REVIEW 的提现单，避免 reviewer
              在过期队列上误操作。
            </p>
          </div>
          <span className="panel__pill">{items.length} open</span>
        </div>
        <ReviewQueue
          items={items}
          activeWithdrawalId={activeReview?.withdrawalId ?? null}
          onSelect={onSelect}
        />
      </article>

      <article>
        <div className="panel__header">
          <div>
            <p className="panel__eyebrow">Review Detail</p>
            <h3 className="panel__title">审核详情与动作</h3>
            <p className="panel__text">
              approve 会把 frozen 迁移到 pending 并生成 ticket，reject 会把
              frozen 释放回 available。
            </p>
          </div>
          {activeReview ? (
            <span className="panel__pill">{activeReview.amountUsdc} USDC</span>
          ) : null}
        </div>

        <ReviewDetail
          activeReview={activeReview}
          canDecide={canDecide}
          decisionNote={decisionNote}
          isPending={isPending}
          canSubmitActiveDecision={canSubmitActiveDecision}
          onDecisionNoteChange={onDecisionNoteChange}
          onDecision={onDecision}
        />
      </article>
    </section>
  );
}
