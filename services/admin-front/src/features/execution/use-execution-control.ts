"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";

import {
  listExecutionJobs,
  retryExecutionJob,
  type ExecutionJobItem,
} from "@/services/admin-api";

import {
  buildExecutionFailureClusters,
  buildExecutionMetrics,
  buildExecutionTargetCards,
  filterExecutionJobs,
  listExecutionTargets,
  sortExecutionJobsByPriority,
} from "./execution-presenters";

export type RequestExecutionStepUpCode = (request: {
  title: string;
  description: string;
  confirmLabel: string;
}) => Promise<string | undefined>;

export function useExecutionControl({
  requestStepUpCode,
  token,
}: Readonly<{
  requestStepUpCode: RequestExecutionStepUpCode;
  token: string | null;
}>) {
  const [jobs, setJobs] = useState<ExecutionJobItem[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  async function refresh() {
    if (!token) {
      return;
    }
    setJobs(await fetchExecutionJobs(token));
  }

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    void loadExecutionJobs({
      isCancelled: () => cancelled,
      setBootstrapping,
      setError,
      setJobs,
      token,
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function retryJob(job: ExecutionJobItem) {
    if (!token) {
      throw new Error("Missing admin token");
    }

    await retryExecutionQueueJob({
      job,
      refresh,
      requestStepUpCode,
      setError,
      setMessage,
      setRetryingJobId,
      token,
    });
  }

  const visibleJobs = useMemo(
    () =>
      sortExecutionJobsByPriority(
        filterExecutionJobs(jobs, deferredSearch, statusFilter, targetFilter)
      ),
    [deferredSearch, jobs, statusFilter, targetFilter]
  );

  return {
    bootstrapping,
    error,
    failureClusters: useMemo(
      () => buildExecutionFailureClusters(jobs).slice(0, 4),
      [jobs]
    ),
    hotJobs: visibleJobs.slice(0, 4),
    jobs,
    message,
    metrics: useMemo(() => buildExecutionMetrics(jobs), [jobs]),
    retryingJobId,
    retryJob,
    search,
    setSearch,
    setStatusFilter,
    setTargetFilter,
    statusFilter,
    targetCards: useMemo(() => buildExecutionTargetCards(jobs), [jobs]),
    targetFilter,
    targetOptions: useMemo(() => listExecutionTargets(jobs), [jobs]),
    visibleJobs,
  };
}

async function loadExecutionJobs({
  isCancelled,
  setBootstrapping,
  setError,
  setJobs,
  token,
}: Readonly<{
  isCancelled: () => boolean;
  setBootstrapping: (value: boolean) => void;
  setError: (value: string | null) => void;
  setJobs: (value: ExecutionJobItem[]) => void;
  token: string;
}>) {
  try {
    const jobs = await fetchExecutionJobs(token);
    if (isCancelled()) {
      return;
    }
    setJobs(jobs);
    setError(null);
  } catch (loadError) {
    if (!isCancelled()) {
      setError(executionErrorMessage(loadError, "加载执行队列失败"));
    }
  } finally {
    if (!isCancelled()) {
      setBootstrapping(false);
    }
  }
}

async function retryExecutionQueueJob({
  job,
  refresh,
  requestStepUpCode,
  setError,
  setMessage,
  setRetryingJobId,
  token,
}: Readonly<{
  job: ExecutionJobItem;
  refresh: () => Promise<void>;
  requestStepUpCode: RequestExecutionStepUpCode;
  setError: (value: string | null) => void;
  setMessage: (value: string | null) => void;
  setRetryingJobId: (value: string | null) => void;
  token: string;
}>) {
  setRetryingJobId(job.jobId);
  setMessage(null);
  try {
    const otpCode = await requestStepUpCode({
      title: "重试执行任务",
      description: `你正在重试任务 ${job.jobId}，这会重新触发 gateway 内部命令并写入 execution attempt。`,
      confirmLabel: "确认重试",
    });
    const result = await retryExecutionJob(token, job.jobId, otpCode);
    setMessage(
      `${result.jobId} 已进入 ${result.status}，retry ${result.retryCount}`
    );
    setError(null);
    await refresh();
  } catch (actionError) {
    setError(executionErrorMessage(actionError, "重试执行任务失败"));
  } finally {
    setRetryingJobId(null);
  }
}

async function fetchExecutionJobs(token: string): Promise<ExecutionJobItem[]> {
  const response = await listExecutionJobs(token, { limit: 50 });
  return response.items;
}

function executionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
