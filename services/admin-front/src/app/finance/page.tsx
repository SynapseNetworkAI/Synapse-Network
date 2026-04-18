"use client";

import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { DataTable, MessageBanner, MetricCard, MetricLabelWithHint, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th } from "@/components/console-ui";
import { getApprovalStatusLabel, getApprovalStatusTone, getApprovalTypeLabel } from "@/features/approval/approval-presenters";
import { CapitalPulseSurface } from "@/features/finance/capital-pulse-surface";
import { CapitalPulseTrendSurface } from "@/features/finance/capital-pulse-trend-surface";
import {
  buildCapitalPulseTrendLanes,
  buildFinanceCapitalPulseLanes,
  buildFinanceDeltaCards,
  buildFinanceFlowVolumeCards,
  buildFinancePressureCards,
  buildFinanceTreasuryCoreCards,
  filterFinanceApprovals,
  getVaultDeltaTone,
} from "@/features/finance/finance-presenters";
import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  getActivityTrends,
  getFinanceOverview,
  getReconciliationDetail,
  listApprovals,
  type ActivityTrendPoint,
  type ApprovalItem,
  type FinanceOverview,
  type ReconciliationDetail,
} from "@/services/admin-api";

export default function FinancePage() {
  const { admin, token, loading } = useAdminSession();
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [reconciliationDetail, setReconciliationDetail] = useState<ReconciliationDetail | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [trendPoints, setTrendPoints] = useState<ActivityTrendPoint[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const capitalPulseLanes = useMemo(() => (overview ? buildFinanceCapitalPulseLanes(overview) : []), [overview]);
  const capitalPulseTrendLanes = useMemo(() => (overview ? buildCapitalPulseTrendLanes(overview, trendPoints) : []), [overview, trendPoints]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const activeToken = token;
    let cancelled = false;

    async function load() {
      try {
        const [finance, reconciliation, approvalQueue, activityTrends] = await Promise.all([
          getFinanceOverview(activeToken),
          getReconciliationDetail(activeToken),
          listApprovals(activeToken, { limit: 12 }),
          getActivityTrends(activeToken),
        ]);

        if (!cancelled) {
          setOverview(finance);
          setReconciliationDetail(reconciliation);
          setApprovals(filterFinanceApprovals(approvalQueue.items));
          setTrendPoints(activityTrends.points);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载资金运营模块失败");
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || !admin || bootstrapping) {
    return <ControlPlaneLoadingScreen title="资金页面加载中" message="正在整理资金相关数据..." />;
  }

  if (!overview) {
    return (
      <AdminShell
        admin={admin}
        eyebrow="资金管理"
        title="资金概览"
        description="把平台当前的资金情况放在同一页，方便先判断整体是否正常，再决定是否进入明细排查。"
      >
        {error ? <MessageBanner kind="error" message={error} /> : <MessageBanner kind="error" message="资金运营视图暂时不可用。" />}
      </AdminShell>
    );
  }

  const treasuryCoreCards = buildFinanceTreasuryCoreCards(overview, reconciliationDetail);
  const deltaCards = buildFinanceDeltaCards(overview, reconciliationDetail);
  const flowVolumeCards = buildFinanceFlowVolumeCards(overview);
  const pressureCards = buildFinancePressureCards(overview);

  return (
    <AdminShell
      admin={admin}
      eyebrow="资金管理"
      title="资金概览"
      description="把平台当前的资金情况放在同一页，方便业务先看余额、收支和待处理事项，再决定是否进入明细排查。"
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}

      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        {treasuryCoreCards.map((card) => (
          <MetricCard
            key={card.key}
            label={<MetricLabelWithHint label={card.label} hint={card.hint} />}
            value={card.value}
            meta={card.description}
          />
        ))}
      </Grid>

      <CapitalPulseSurface
        eyebrow="今日资金动态"
        title="今天的资金变化"
        description="把用户侧、平台侧、服务商侧今天的主要资金变化放在一起，先看哪里在进、哪里在出。"
        lanes={capitalPulseLanes}
        stamp={overview.projectedAt}
      />

      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <SurfaceCard eyebrow="资金差异" title="整体是否对得上" description="这里先看平台整体资金是否平衡。若发现差异，再进入对账明细查看原因。" stamp={overview.projectedAt ?? "live"}>
          <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="12px">
            {deltaCards.map((card) => (
              <Box key={card.key} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Box fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">
                  <MetricLabelWithHint label={card.label} hint={card.hint} />
                </Box>
                <Heading mt="10px" size="md">{card.value}</Heading>
                <Text mt="8px" color="ink.500">{card.description}</Text>
              </Box>
            ))}
          </Grid>
        </SurfaceCard>

        <SurfaceCard eyebrow="收支规模" title="充值、消费、退款、提现" description="把今天的主要收支规模放在一起，帮助快速判断当前资金变化是不是符合业务预期。" stamp={overview.projectedAt ?? "live"}>
          <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="12px">
            {flowVolumeCards.map((card) => (
              <Box key={card.key} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Box fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">
                  <MetricLabelWithHint label={card.label} hint={card.hint} />
                </Box>
                <Heading mt="10px" size="md">{card.value}</Heading>
                <Text mt="8px" color="ink.500">{card.description}</Text>
              </Box>
            ))}
          </Grid>
        </SurfaceCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1.08fr 0.92fr" }} gap="16px">
        <CapitalPulseTrendSurface
          eyebrow="七日变化趋势"
          title="最近七天的资金节奏"
          description="看最近七天用户活跃、平台收入和服务商提现节奏有没有明显变化，方便判断是短期波动还是持续趋势。"
          lanes={capitalPulseTrendLanes}
          stamp={overview.projectedAt ?? "live"}
        />
        <SurfaceCard eyebrow="待处理事项" title="当前需要关注什么" description="这里汇总需要优先留意的资金事项，并提供直接入口，方便继续处理。">
          <Stack gap="12px">
            <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
              <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">资金差异提醒</Text>
              <Stack mt="10px" direction="row" align="center" justify="space-between">
                <Heading size="md">{formatUsdc(overview.vaultLedgerDeltaUsdc)} USDC</Heading>
                <SentinelStatusChip label={getVaultDeltaTone(overview.vaultLedgerDeltaUsdc).toUpperCase()} tone={getVaultDeltaTone(overview.vaultLedgerDeltaUsdc)} />
              </Stack>
              <Text mt="8px" color="ink.500">如果这里出现明显差异，建议进入对账明细进一步查看原因。</Text>
              <Link href="/finance/reconciliation"><Button mt="12px" size="sm" borderRadius="full">查看对账详情</Button></Link>
            </Box>

            {pressureCards.map((card) => (
              <Box key={card.key} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Box fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">
                  <MetricLabelWithHint label={card.label} hint={card.hint} />
                </Box>
                <Heading mt="8px" size="md">{card.value}</Heading>
                <Text mt="8px" color="ink.500">{card.description}</Text>
              </Box>
            ))}

            <Link href="/withdrawal-reviews"><Button borderRadius="full" bg="brand.500" color="white" _hover={{ bg: "brand.600" }}>进入提现审核</Button></Link>
          </Stack>
        </SurfaceCard>
      </Grid>

      <SurfaceCard eyebrow="相关审批" title="和资金有关的待办" description="把退款、提现、异常入账等相关审批放在这里，方便业务统一查看当前待处理事项。">
        <DataTable>
          <TableHeaderRow>
            <Th>Approval</Th>
            <Th>Type</Th>
            <Th>Amount</Th>
            <Th>Status</Th>
            <Th>Created</Th>
          </TableHeaderRow>
          <TableBody>
            {approvals.map((item) => (
              <Box as="tr" key={item.approvalId}>
                <Td>
                  <Text fontWeight="700">{item.approvalId}</Text>
                  <Text color="ink.500">{item.requesterRole}</Text>
                </Td>
                <Td>
                  <Text>{getApprovalTypeLabel(item.approvalType)}</Text>
                  <Text color="ink.500">{item.approvalType}</Text>
                </Td>
                <Td>{formatUsdc(item.amountUsdc)}</Td>
                <Td><SentinelStatusChip label={getApprovalStatusLabel(item.status)} tone={getApprovalStatusTone(item.status)} /></Td>
                <Td>{formatDateTime(item.createdAt)}</Td>
              </Box>
            ))}
          </TableBody>
        </DataTable>
      </SurfaceCard>
    </AdminShell>
  );
}
