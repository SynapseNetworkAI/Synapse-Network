"use client";

import { useEffect, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { AuditLogTable } from "@/features/audit/audit-log-table";
import { useAdminSession } from "@/lib/use-admin-session";
import { listAuditActions, type AuditActionItem } from "@/services/admin-api";


export default function AuditPage() {
  const { admin, token, loading } = useAdminSession();
  const [items, setItems] = useState<AuditActionItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    async function load() {
      try {
        const response = await listAuditActions(activeToken, { limit: 100 });
        if (!cancelled) {
          setItems(response.items);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载审计日志失败");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || !admin) {
    return <main className="state-screen">正在检索审计链路...</main>;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Audit & Compliance"
      title="操作日志与审计追踪"
      description="关键资金动作、后台用户变更和审批决策统一落审计，避免控制面成为黑盒。"
    >
      {error ? <section className="panel"><p className="form-message form-message--error">{error}</p></section> : null}
      <AuditLogTable items={items} />
    </AdminShell>
  );
}