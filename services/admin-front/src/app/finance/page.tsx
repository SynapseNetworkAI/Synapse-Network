"use client";

import { Grid } from "@chakra-ui/react";
import { useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { CapitalPulseSurface } from "@/features/finance/capital-pulse-surface";
import { CapitalPulseTrendSurface } from "@/features/finance/capital-pulse-trend-surface";
import {
  FinanceApprovalsSurface,
  FinanceAttentionSurface,
  FinanceCardGrid,
  FinanceDeltaVolumeGrid,
} from "@/features/finance/finance-page-sections";
import {
  buildCapitalPulseTrendLanes,
  buildFinanceCapitalPulseLanes,
  buildFinanceDeltaCards,
  buildFinanceFlowVolumeCards,
  buildFinancePressureCards,
  buildFinanceTreasuryCoreCards,
} from "@/features/finance/finance-presenters";
import {
  PlatformFeeTreasuryModal,
  canUsePlatformFeeTreasury,
} from "@/features/finance/platform-fee-treasury-modal";
import { useFinancePageData } from "@/features/finance/use-finance-page-data";
import { useAdminSession } from "@/lib/use-admin-session";

export default function FinancePage() {
  const { admin, security, token, loading } = useAdminSession();
  const [platformFeeModalOpen, setPlatformFeeModalOpen] = useState(false);
  const {
    approvals,
    bootstrapping,
    error,
    overview,
    reconciliationDetail,
    trendPoints,
  } = useFinancePageData(token);
  const capitalPulseLanes = useMemo(
    () => (overview ? buildFinanceCapitalPulseLanes(overview) : []),
    [overview]
  );
  const capitalPulseTrendLanes = useMemo(
    () => (overview ? buildCapitalPulseTrendLanes(overview, trendPoints) : []),
    [overview, trendPoints]
  );

  if (loading || !admin || bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="资金页面加载中"
        message="正在整理资金相关数据..."
      />
    );
  }

  if (!overview) {
    return (
      <AdminShell
        admin={admin}
        eyebrow="资金管理"
        title="资金概览"
        description="把平台当前的资金情况放在同一页，方便先判断整体是否正常，再决定是否进入明细排查。"
      >
        {error ? (
          <MessageBanner kind="error" message={error} />
        ) : (
          <MessageBanner kind="error" message="资金运营视图暂时不可用。" />
        )}
      </AdminShell>
    );
  }

  const treasuryCoreCards = buildFinanceTreasuryCoreCards(
    overview,
    reconciliationDetail
  );
  const deltaCards = buildFinanceDeltaCards(overview, reconciliationDetail);
  const flowVolumeCards = buildFinanceFlowVolumeCards(overview);
  const pressureCards = buildFinancePressureCards(overview);
  const canOpenPlatformFeeTreasury = canUsePlatformFeeTreasury(admin.role);

  return (
    <AdminShell
      admin={admin}
      eyebrow="资金管理"
      title="资金概览"
      description="把平台当前的资金情况放在同一页，方便业务先看余额、收支和待处理事项，再决定是否进入明细排查。"
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}

      <FinanceCardGrid cards={treasuryCoreCards} />

      <CapitalPulseSurface
        eyebrow="今日资金动态"
        title="今天的资金变化"
        description="把用户侧、平台侧、服务商侧今天的主要资金变化放在一起，先看哪里在进、哪里在出。"
        lanes={capitalPulseLanes}
        stamp={overview.projectedAt}
      />

      <FinanceDeltaVolumeGrid
        projectedAt={overview.projectedAt}
        deltaCards={deltaCards}
        flowVolumeCards={flowVolumeCards}
      />

      <Grid templateColumns={{ base: "1fr", xl: "1.08fr 0.92fr" }} gap="16px">
        <CapitalPulseTrendSurface
          eyebrow="七日变化趋势"
          title="最近七天的资金节奏"
          description="看最近七天用户活跃、平台收入和服务商提现节奏有没有明显变化，方便判断是短期波动还是持续趋势。"
          lanes={capitalPulseTrendLanes}
          stamp={overview.projectedAt ?? "live"}
        />
        <FinanceAttentionSurface
          overview={overview}
          pressureCards={pressureCards}
          canOpenPlatformFeeTreasury={canOpenPlatformFeeTreasury}
          onOpenPlatformFeeTreasury={() => setPlatformFeeModalOpen(true)}
        />
      </Grid>

      <FinanceApprovalsSurface approvals={approvals} />
      {token ? (
        <PlatformFeeTreasuryModal
          open={platformFeeModalOpen}
          security={security}
          onClose={() => setPlatformFeeModalOpen(false)}
        />
      ) : null}
    </AdminShell>
  );
}
