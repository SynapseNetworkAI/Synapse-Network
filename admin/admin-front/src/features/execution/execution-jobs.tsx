"use client";

import { useTransition } from "react";

import type { ExecutionJobItem } from "@/services/admin-api";


type ExecutionJobsProps = {
  items: ExecutionJobItem[];
  onRetry: (jobId: string) => Promise<void>;
};


export function ExecutionJobs({ items, onRetry }: Readonly<ExecutionJobsProps>) {
  const [isPending, startTransition] = useTransition();

  return (
    <section className="dashboard-section">
      <div className="dashboard-section__header">
        <div>
          <p className="panel__eyebrow">Execution Queue</p>
          <h3 className="panel__title">执行任务与重试</h3>
          <p className="panel__text">审批通过后的高风险动作统一转成 execution jobs，由后台 worker 自动消费或由 reviewer 手工重试。</p>
        </div>
        <span className="dashboard-section__stamp">{items.length} jobs</span>
      </div>
      <div className="queue">
        {items.map((job) => (
          <article key={job.jobId} className="queue__item queue__item--stacked">
            <div className="queue__body">
              <div>
                <p className="queue__id">{job.jobId}</p>
                <h4>{job.executionType}</h4>
                <p className="queue__meta">approval: {job.approvalId} · target: {job.targetSystem} · retry {job.retryCount}/{job.maxRetryCount}</p>
              </div>
              <div className="pill-row">
                <span className={`status-pill ${job.status === "SUCCEEDED" ? "status-pill--healthy" : job.status === "FAILED" ? "status-pill--alert" : "status-pill--degraded"}`}>
                  {job.status}
                </span>
                {job.errorCode ? <span className="permission-chip">{job.errorCode}</span> : null}
              </div>
            </div>
            <div className="queue__body queue__body--secondary">
              <div className="pill-row">
                {job.attempts.map((attempt) => (
                  <span key={`${job.jobId}-${attempt.attemptNo}`} className="permission-chip">
                    #{attempt.attemptNo} {attempt.status}
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="button button--secondary"
                disabled={isPending || job.status !== "FAILED"}
                onClick={() => startTransition(async () => onRetry(job.jobId))}
              >
                {isPending ? "处理中..." : "重试执行"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}