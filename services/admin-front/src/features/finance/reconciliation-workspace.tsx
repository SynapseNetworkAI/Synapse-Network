"use client";

import { Button } from "@chakra-ui/react";
import Link from "next/link";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner, SurfaceCard } from "@/components/console-ui";
import { useAdminSession } from "@/lib/use-admin-session";
import type { AdminProfile, ReconciliationDetail } from "@/services/admin-api";

import { ReconciliationCrossLocatorCard } from "./reconciliation-drilldown-section";
import { ReconciliationEvidenceGrid } from "./reconciliation-evidence-section";
import { type DrilldownToken } from "./reconciliation-presenters";
import { PriorityApprovalsSection } from "./reconciliation-queue-sections";
import {
  ReconciliationMetricGrid,
  ReconciliationSummaryGrid,
} from "./reconciliation-summary-section";
import { useReconciliationDetail } from "./use-reconciliation-detail";

export function ReconciliationWorkspace() {
  const { admin, token, loading } = useAdminSession();
  const reconciliation = useReconciliationDetail(token);

  if (loading || !admin || reconciliation.bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="Reconciliation Detail Sync"
        message="正在同步对账详情..."
      />
    );
  }

  if (!reconciliation.detail) {
    return (
      <ReconciliationUnavailable admin={admin} error={reconciliation.error} />
    );
  }

  return (
    <ReconciliationShell
      admin={admin}
      detail={reconciliation.detail}
      drilldown={reconciliation.drilldown}
      drilldownError={reconciliation.drilldownError}
      drilldownLoading={reconciliation.drilldownLoading}
      error={reconciliation.error}
      onClearDrilldown={reconciliation.clearDrilldown}
      onDrilldown={reconciliation.loadDrilldown}
    />
  );
}

function ReconciliationShell({
  admin,
  detail,
  drilldown,
  drilldownError,
  drilldownLoading,
  error,
  onClearDrilldown,
  onDrilldown,
}: Readonly<{
  admin: AdminProfile;
  detail: ReconciliationDetail;
  drilldown: ReturnType<typeof useReconciliationDetail>["drilldown"];
  drilldownError: string | null;
  drilldownLoading: boolean;
  error: string | null;
  onClearDrilldown: () => void;
  onDrilldown: (token: DrilldownToken) => void;
}>) {
  return (
    <AdminShell
      admin={admin}
      eyebrow="Finance Admin"
      title="对账调查页"
      description="当 Finance 已经判断出现偏差后，在这里集中查看链上证据、入账证据、出账证据和关联处置队列。"
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <ReconciliationMetricGrid detail={detail} />
      <ReconciliationSummaryGrid detail={detail} />
      <ReconciliationEvidenceGrid
        detail={detail}
        drilldownLoading={drilldownLoading}
        onDrilldown={onDrilldown}
      />
      <ReconciliationPriorityQueueCard
        detail={detail}
        drilldownLoading={drilldownLoading}
        onDrilldown={onDrilldown}
      />
      <ReconciliationCrossLocatorCard
        drilldown={drilldown}
        drilldownError={drilldownError}
        onClear={onClearDrilldown}
      />
    </AdminShell>
  );
}

function ReconciliationPriorityQueueCard({
  detail,
  drilldownLoading,
  onDrilldown,
}: Readonly<{
  detail: ReconciliationDetail;
  drilldownLoading: boolean;
  onDrilldown: (token: DrilldownToken) => void;
}>) {
  return (
    <SurfaceCard
      eyebrow="Exception Queue"
      title="相关审批单"
      description="这里聚合对账偏差处置最相关的 finance approvals，避免 operator 再从首页回忆该去哪张表。"
      actions={
        <Link href="/approvals?status=UNDER_REVIEW">
          <Button size="sm" borderRadius="full">
            打开审批中心
          </Button>
        </Link>
      }
    >
      <PriorityApprovalsSection
        items={detail.priorityApprovals}
        drilldownLoading={drilldownLoading}
        onDrilldown={onDrilldown}
      />
    </SurfaceCard>
  );
}

function ReconciliationUnavailable({
  admin,
  error,
}: Readonly<{ admin: AdminProfile; error: string | null }>) {
  return (
    <AdminShell
      admin={admin}
      eyebrow="Finance Admin"
      title="账本对账详情"
      description="把资金偏差调查展开成可操作的值班视图。"
    >
      {error ? (
        <MessageBanner kind="error" message={error} />
      ) : (
        <MessageBanner kind="error" message="对账详情暂时不可用。" />
      )}
    </AdminShell>
  );
}
