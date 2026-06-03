"use client";

import { Grid, Stack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { useAdminSession } from "@/lib/use-admin-session";
import { useAdminStepUp } from "@/lib/use-admin-step-up";
import type { AdminProfile } from "@/services/admin-api";

import { ExecutionFailureClusters } from "./execution-failure-clusters";
import { ExecutionHotQueue } from "./execution-hot-queue";
import { ExecutionQueueTable } from "./execution-queue-table";
import { ExecutionSummary } from "./execution-summary";
import { ExecutionTargetDomains } from "./execution-target-domains";
import { useExecutionControl } from "./use-execution-control";

export function ExecutionWorkspace() {
  const { admin, security, token, loading } = useAdminSession();
  const { requestStepUpCode, stepUpModal } = useAdminStepUp({
    enabled: security?.highRiskTotpRequired ?? false,
    issuer: security?.totpIssuer ?? "Synapse Gateway Admin",
  });
  const execution = useExecutionControl({ requestStepUpCode, token });

  if (loading || !admin || execution.bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="Execution Queue Sync"
        message="正在同步执行任务..."
      />
    );
  }

  return (
    <ExecutionShell
      admin={admin}
      execution={execution}
      stepUpModal={stepUpModal}
    />
  );
}

function ExecutionShell({
  admin,
  execution,
  stepUpModal,
}: Readonly<{
  admin: AdminProfile;
  execution: ReturnType<typeof useExecutionControl>;
  stepUpModal: ReactNode;
}>) {
  return (
    <AdminShell
      admin={admin}
      eyebrow="Execution Control"
      title="执行队列"
      description="这里只处理受控命令的失败、重试与追踪，不解释系统健康，也不承担业务分诊。"
    >
      <Stack gap="16px">
        {execution.message ? (
          <MessageBanner kind="success" message={execution.message} />
        ) : null}
        {execution.error ? (
          <MessageBanner kind="error" message={execution.error} />
        ) : null}
        <ExecutionSummary metrics={execution.metrics} />
        <Grid templateColumns={{ base: "1fr", xl: "0.88fr 1.12fr" }} gap="16px">
          <ExecutionFailureClusters clusters={execution.failureClusters} />
          <ExecutionQueueTable
            jobs={execution.visibleJobs}
            onRetry={execution.retryJob}
            retryingJobId={execution.retryingJobId}
            search={execution.search}
            setSearch={execution.setSearch}
            setStatusFilter={execution.setStatusFilter}
            setTargetFilter={execution.setTargetFilter}
            statusFilter={execution.statusFilter}
            targetFilter={execution.targetFilter}
            targetOptions={execution.targetOptions}
            totalJobs={execution.jobs.length}
          />
        </Grid>
        <Grid templateColumns={{ base: "1fr", xl: "0.98fr 1.02fr" }} gap="16px">
          <ExecutionHotQueue jobs={execution.hotJobs} />
          <ExecutionTargetDomains cards={execution.targetCards} />
        </Grid>
      </Stack>
      {stepUpModal}
    </AdminShell>
  );
}
