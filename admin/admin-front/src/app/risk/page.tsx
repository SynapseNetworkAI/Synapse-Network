"use client";

import { useEffect, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { useAdminSession } from "@/lib/use-admin-session";
import { listApprovals, type ApprovalItem } from "@/services/admin-api";


export default function RiskPage() {
  const { admin, token, loading } = useAdminSession();
  const [riskItems, setRiskItems] = useState<ApprovalItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    async function load() {
      try {
        const approvals = await listApprovals(activeToken, { limit: 20 });
        if (!cancelled) {
          setRiskItems(approvals.items.filter((item) => item.approvalType.includes("risk")));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载风控模块失败");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || !admin) {
    return <main className="state-screen">正在构建风控工作台...</main>;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Risk Console"
      title="风控工作台"
      description="风险标签、阈值策略和异常资金动作不应该散在脚本里，而应该进入后台控制面编排。"
    >
      {error ? <section className="panel"><p className="form-message form-message--error">{error}</p></section> : null}
      <section className="panel panel--split">
        <article>
          <p className="panel__eyebrow">Policy Domains</p>
          <h3 className="panel__title">风控模块树</h3>
          <div className="catalog-list">
            {[
              ["高风险充值", "发现链上确认成功但链下入账异常、来源地址异常或大额集中充值。"],
              ["大额提现审核", "超阈值提现统一进入 reviewer 决策和 execution queue。"],
              ["黑白名单维护", "未来接受控名单命令，不让名单变更绕过审批。"],
              ["风险标签处置", "对账户打标、解除标记和策略豁免进行审计留痕。"],
            ].map(([title, description]) => (
              <div key={title} className="catalog-card">
                <div className="catalog-card__header"><strong>{title}</strong></div>
                <p className="table-subtext">{description}</p>
              </div>
            ))}
          </div>
        </article>
        <article>
          <p className="panel__eyebrow">Risk Approval Queue</p>
          <h3 className="panel__title">风险相关审批</h3>
          <div className="queue">
            {riskItems.length > 0 ? riskItems.map((item) => (
              <article key={item.approvalId} className="queue__item queue__item--stacked">
                <div className="queue__body">
                  <div>
                    <p className="queue__id">{item.approvalId}</p>
                    <h4>{item.approvalType}</h4>
                    <p className="queue__meta">{item.requesterRole} · {item.approvalLevel}</p>
                  </div>
                  <span className="queue__status">{item.status}</span>
                </div>
              </article>
            )) : <p className="panel__text">当前没有 risk 相关审批单，模块已准备好承接后续策略工单。</p>}
          </div>
        </article>
      </section>
    </AdminShell>
  );
}