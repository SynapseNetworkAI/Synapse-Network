"use client";

import { Button, Grid } from "@chakra-ui/react";
import Link from "next/link";
import { useMemo } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { CapitalPulseSurface } from "@/features/finance/capital-pulse-surface";
import {
  DashboardDiagnosticsSurface,
  DashboardFlowSnapshotSurface,
  DashboardQueuePressureSurface,
  DashboardSentinelMetricsGrid,
} from "@/features/dashboard/dashboard-surfaces";
import {
  buildDashboardCapitalPulseLanes,
  buildDashboardFlowCards,
  buildDashboardFunnelCards,
  buildDashboardPressureCards,
  buildSentinelMetrics,
} from "@/features/dashboard/dashboard-presenters";
import { omitDiagnosticSignals } from "@/features/diagnostics/diagnostic-presenters";
import { useDashboardSnapshot } from "@/features/dashboard/use-dashboard-snapshot";
import type { AdminProfile } from "@/services/admin-api";

export function DashboardOverviewScreen({ admin, token }: Readonly<{ admin: AdminProfile; token: string }>) {
  const {
    overview,
    financeOverview,
    operationsOverview,
    reconciliationDetail,
    diagnostics,
    diagnosticError,
    diagnosticsLoading,
    refreshDiagnostics,
    bootstrapping,
    error,
  } = useDashboardSnapshot(token, { includeApprovals: false });

  const sentinelMetrics = useMemo(() => {
    return buildSentinelMetrics(overview, operationsOverview, diagnostics, reconciliationDetail);
  }, [diagnostics, operationsOverview, overview, reconciliationDetail]);
  const overviewDiagnostics = useMemo(() => omitDiagnosticSignals(diagnostics, ["reconciliation"]), [diagnostics]);

  const flowCards = useMemo(() => buildDashboardFlowCards(financeOverview), [financeOverview]);
  const pressureCards = useMemo(() => buildDashboardPressureCards(overview, financeOverview), [financeOverview, overview]);
  const funnelCards = useMemo(() => buildDashboardFunnelCards(financeOverview, operationsOverview, null), [financeOverview, operationsOverview]);
  const capitalPulseLanes = useMemo(() => buildDashboardCapitalPulseLanes(financeOverview), [financeOverview]);

  if (bootstrapping) {
    return <ControlPlaneLoadingScreen title="概览加载中" message="正在汇总首页关键数据，请稍候..." />;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="控制台概览"
      title="控制台概览"
      description="把当前整体情况、今日资金变化和待处理事项集中在首页，方便业务同学先判断哪里需要优先跟进。"
      actions={(
        <>
          <Link href="/dashboard/runtime"><Button borderRadius="full" variant="ghost">查看业务运行情况</Button></Link>
          <Link href="/system"><Button borderRadius="full" bg="#0f1115" color="#f4f7fb" _hover={{ bg: "#1b1f26" }}>查看系统状态</Button></Link>
        </>
      )}
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <DashboardSentinelMetricsGrid metrics={sentinelMetrics} />
      <DashboardDiagnosticsSurface
        diagnostics={overviewDiagnostics}
        diagnosticError={diagnosticError}
        diagnosticsLoading={diagnosticsLoading}
        onRefresh={() => {
          refreshDiagnostics(token);
        }}
        funnelCards={funnelCards}
      />
      <CapitalPulseSurface
        eyebrow="Capital Pulse"
        title="资金链路摘要"
        description="首页只保留 Consumer、Platform、Provider 三侧的紧凑摘要，帮助值班员快速判断今天的资金活动发生在哪一侧。"
        lanes={capitalPulseLanes}
        compact
        ctaHref="/finance"
        ctaLabel="打开 Finance Desk"
      />
      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <DashboardFlowSnapshotSurface flowCards={flowCards} />
        <DashboardQueuePressureSurface pressureCards={pressureCards} />
      </Grid>
    </AdminShell>
  );
}