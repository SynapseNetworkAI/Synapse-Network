"use client";

import { Grid } from "@chakra-ui/react";

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
import type {
  ApprovalItem,
  ActivityTrendPoint,
  FinanceOverview,
  ReconciliationDetail,
} from "@/services/admin-api";

export function FinanceOverviewTab({
  approvals,
  canOpenPlatformFeeTreasury,
  onOpenPlatformFeeTreasury,
  overview,
  reconciliationDetail,
  trendPoints,
}: Readonly<{
  approvals: ApprovalItem[];
  canOpenPlatformFeeTreasury: boolean;
  onOpenPlatformFeeTreasury: () => void;
  overview: FinanceOverview;
  reconciliationDetail: ReconciliationDetail | null;
  trendPoints: ActivityTrendPoint[];
}>) {
  const treasuryCoreCards = buildFinanceTreasuryCoreCards(
    overview,
    reconciliationDetail
  );
  const deltaCards = buildFinanceDeltaCards(overview, reconciliationDetail);
  const flowVolumeCards = buildFinanceFlowVolumeCards(overview);
  const pressureCards = buildFinancePressureCards(overview);
  const capitalPulseLanes = buildFinanceCapitalPulseLanes(overview);
  const capitalPulseTrendLanes = buildCapitalPulseTrendLanes(
    overview,
    trendPoints
  );

  return (
    <>
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
          onOpenPlatformFeeTreasury={onOpenPlatformFeeTreasury}
        />
      </Grid>
      <FinanceApprovalsSurface approvals={approvals} />
    </>
  );
}
