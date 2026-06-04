"use client";

import { Grid, Stack } from "@chakra-ui/react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { useAdminSession } from "@/lib/use-admin-session";
import type { AdminProfile } from "@/services/admin-api";

import { RuntimeSnapshotPanel } from "./runtime-snapshot-panel";
import { SystemDiagnosticsExtra } from "./system-diagnostics-extra";
import { SystemSummary } from "./system-summary";
import { useSystemStatus } from "./use-system-status";

const SYSTEM_DESCRIPTION =
  "这里负责查看 gateway 相关运行快照、执行异常和持久化任务状态；indexer / backfill / reconciliation 现在展示真实后端任务状态，而不是 projection proxy。";

export function SystemWorkspace() {
  const { admin, token, loading } = useAdminSession();
  const system = useSystemStatus(token);

  if (loading || !admin || system.bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="Runtime Snapshot Sync"
        message="正在同步系统运行状态..."
      />
    );
  }

  return <SystemShell admin={admin} system={system} />;
}

function SystemShell({
  admin,
  system,
}: Readonly<{
  admin: AdminProfile;
  system: ReturnType<typeof useSystemStatus>;
}>) {
  if (!system.status || !system.operations) {
    return (
      <AdminShell
        admin={admin}
        eyebrow="System Control"
        title="系统运维中心"
        description={SYSTEM_DESCRIPTION}
      >
        <MessageBanner
          kind="error"
          message={system.error ?? "系统运行视图暂时不可用。"}
        />
      </AdminShell>
    );
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="System Control"
      title="系统运维中心"
      description={SYSTEM_DESCRIPTION}
    >
      <Stack gap="16px">
        {system.error ? (
          <MessageBanner kind="error" message={system.error} />
        ) : null}
        <SystemSummary metrics={system.metrics} />
        <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
          <RuntimeSnapshotPanel
            metrics={system.metrics}
            runtimeCards={system.runtimeCards}
            status={system.status}
          />
          <DiagnosticsPanel
            eyebrow="共享诊断"
            title="系统诊断明细"
            descriptionFallback="这里提供完整 diagnostics 结论与组件级调查线索；dashboard 页面只保留摘要，不在那边重复展开。"
            diagnostics={system.systemDiagnostics}
            error={system.diagnosticError}
            statusHint="与 dashboard 概览和系统入口共享同一诊断源；这里展示真实后台执行失败、审批压力，以及 indexer / backfill / reconciliation 的持久化任务状态。"
            actionColumnsMd={2}
            cardRadius="20px"
            cardPadding="16px"
            cardBackground="rgba(255,255,255,0.74)"
            cardBorder="1px solid rgba(99,92,82,0.10)"
            signalHeadingSize="sm"
            extraContent={
              <SystemDiagnosticsExtra
                reconciliationLastError={
                  system.operations.reconciliationLastError
                }
              />
            }
          />
        </Grid>
      </Stack>
    </AdminShell>
  );
}
