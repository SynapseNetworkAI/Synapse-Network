"use client";

import { useEffect, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ExecutionJobs } from "@/features/execution/execution-jobs";
import { useAdminStepUp } from "@/lib/use-admin-step-up";
import { useAdminSession } from "@/lib/use-admin-session";
import { listExecutionJobs, retryExecutionJob, type ExecutionJobItem } from "@/services/admin-api";


export default function ExecutionPage() {
  const { admin, security, token, loading } = useAdminSession();
  const { requestStepUpCode, stepUpModal } = useAdminStepUp({
    enabled: security?.highRiskTotpRequired ?? false,
    issuer: security?.totpIssuer ?? "Synapse Gateway Admin",
  });
  const [jobs, setJobs] = useState<ExecutionJobItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadJobs(activeToken: string) {
    const response = await listExecutionJobs(activeToken, { limit: 50 });
    setJobs(response.items);
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    async function load() {
      try {
        await loadJobs(activeToken);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载执行队列失败");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || !admin) {
    return <main className="state-screen">正在同步执行任务...</main>;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Execution Control"
      title="执行队列"
      description="审批通过后的 gateway 内部命令在这里统一观察、重试和追踪，避免人工操作脱离审计。"
    >
      {error ? <section className="panel"><p className="form-message form-message--error">{error}</p></section> : null}
      <ExecutionJobs
        items={jobs}
        onRetry={async (jobId) => {
          if (!token) {
            throw new Error("Missing admin token");
          }
          const activeToken = token;
          const otpCode = await requestStepUpCode({
            title: "重试执行任务",
            description: `你正在重试任务 ${jobId}，这会重新触发 gateway 内部命令并写入 execution attempt。`,
            confirmLabel: "确认重试",
          });
          await retryExecutionJob(activeToken, jobId, otpCode);
          await loadJobs(activeToken);
        }}
      />
      {stepUpModal}
    </AdminShell>
  );
}