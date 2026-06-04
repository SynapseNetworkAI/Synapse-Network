"use client";

import { Button, Grid } from "@chakra-ui/react";
import Link from "next/link";
import type { ComponentProps } from "react";
import { useMemo } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { findAdminRewriteRoute } from "@/features/admin-rewrite/module-catalog";
import { RewriteModuleWorkspace } from "@/features/admin-rewrite/rewrite-primitives";
import {
  buildBusinessRuntimeLaneCards,
  buildRiskActivityRows,
} from "@/features/dashboard/dashboard-presenters";
import {
  DashboardBusinessRuntimeSurface,
  DashboardThreatStreamSurface,
} from "@/features/dashboard/dashboard-surfaces";
import { useDashboardSnapshot } from "@/features/dashboard/use-dashboard-snapshot";
import type { AdminProfile } from "@/services/admin-api";

export function DashboardRuntimeScreen({
  admin,
  token,
}: Readonly<{ admin: AdminProfile; token: string }>) {
  const {
    approvals,
    bootstrapping,
    error,
    financeOverview,
    overview,
    reconciliationDetail,
  } = useDashboardSnapshot(token);
  const businessLaneCards = useMemo(
    () =>
      buildBusinessRuntimeLaneCards(
        overview,
        financeOverview,
        reconciliationDetail
      ),
    [financeOverview, overview, reconciliationDetail]
  );
  const riskActivityRows = useMemo(
    () => buildRiskActivityRows(approvals),
    [approvals]
  );
  const rewriteSpec = findAdminRewriteRoute("/dashboard/runtime");
  const runtimeMetrics = businessLaneCards.map((card) => ({
    label: card.title,
    meta: card.detail,
    value: card.summary,
  }));

  if (bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="Runtime Surface Sync"
        message="正在同步 dashboard runtime 子页面..."
      />
    );
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Dashboard Runtime"
      title="业务运行态"
      description="只看审批、充值、出账三条业务链路是否堵塞。系统组件异常去系统运维中心，任务失败处置去执行队列。"
      actions={<DashboardRuntimeActions />}
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      {rewriteSpec ? (
        <RewriteModuleWorkspace spec={rewriteSpec} metrics={runtimeMetrics}>
          <DashboardRuntimeGrid
            businessLaneCards={businessLaneCards}
            riskActivityRows={riskActivityRows}
          />
        </RewriteModuleWorkspace>
      ) : (
        <DashboardRuntimeGrid
          businessLaneCards={businessLaneCards}
          riskActivityRows={riskActivityRows}
        />
      )}
    </AdminShell>
  );
}

function DashboardRuntimeActions() {
  return (
    <>
      <Link href="/system">
        <Button borderRadius="full" variant="ghost">
          查看系统运维状态
        </Button>
      </Link>
      <Link href="/execution">
        <Button
          borderRadius="full"
          bg="#0f1115"
          color="#f4f7fb"
          _hover={{ bg: "#1b1f26" }}
        >
          进入执行队列工作台
        </Button>
      </Link>
    </>
  );
}

function DashboardRuntimeGrid({
  businessLaneCards,
  riskActivityRows,
}: Readonly<{
  businessLaneCards: ComponentProps<
    typeof DashboardBusinessRuntimeSurface
  >["cards"];
  riskActivityRows: ComponentProps<typeof DashboardThreatStreamSurface>["rows"];
}>) {
  return (
    <Grid templateColumns={{ base: "1fr", xl: "0.98fr 1.02fr" }} gap="16px">
      <DashboardBusinessRuntimeSurface cards={businessLaneCards} />
      <DashboardThreatStreamSurface rows={riskActivityRows} />
    </Grid>
  );
}
