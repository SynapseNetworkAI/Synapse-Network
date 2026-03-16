"use client";

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

  return (
    <AdminShell
      admin={admin}
      eyebrow="Approval Workflow"
      title="审批中心"
      description="高风险财务和配置动作必须经过多级审批，执行人和审批人保持职责分离。"
    >
      {error ? <section className="panel"><p className="form-message form-message--error">{error}</p></section> : null}
      <ApprovalQueue items={items} />
      <section className="panel panel--split">
        <article>
          <p className="panel__eyebrow">Flow Rules</p>
          <h3 className="panel__title">审批分级</h3>
          <p className="panel__text">
            读取权限与审批提交权限已分离，真正的审批决策权限只授予 reviewer 角色。
          </p>
        </article>
        <article>
          <p className="panel__eyebrow">Execution Guard</p>
          <h3 className="panel__title">执行前二次确认</h3>
          <p className="panel__text">
            这一页当前消费 `/api/admin/v1/approvals`，下一步直接接审批决策和执行态更新。
          </p>
        </article>
      </section>
    </AdminShell>
  );
}
