"use client";

import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { DataTable, MessageBanner, MetricCard, MetricLabelWithHint, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th } from "@/components/console-ui";
import { getApprovalStatusLabel, getApprovalTypeLabel } from "@/features/approval/approval-presenters";
import { CapitalPulseSurface } from "@/features/finance/capital-pulse-surface";
import {
  buildFinanceCapitalPulseLanes,
  buildFinanceDeltaCards,
  buildFinanceFlowVolumeCards,
  buildFinancePressureCards,
  buildFinanceTreasuryCoreCards,
  buildTrendChartData,
  filterFinanceApprovals,
  getVaultDeltaTone,
} from "@/features/finance/finance-presenters";
import { formatDateTime, formatUsdc, toneFromStatus } from "@/lib/admin-console";
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

  const chartData = useMemo(() => buildTrendChartData(trendPoints), [trendPoints]);
  const capitalPulseLanes = useMemo(() => (overview ? buildFinanceCapitalPulseLanes(overview) : []), [overview]);

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
    return <ControlPlaneLoadingScreen title="Finance Projection Sync" message="正在同步资金运营视图..." />;
  }

  if (!overview) {
    return (
      <AdminShell
        admin={admin}
        eyebrow="Finance Admin"
        title="资金总账判断页"
        description="把链上资产、账本义务、平台收入和流量规模放进同一张总账视图，帮助 operator 先判断健康度，再决定是否进入对账调查。"
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
      eyebrow="Finance Admin"
      title="资金总账判断页"
      description="把链上资产、账本义务、平台收入和流量规模放进同一张总账视图，帮助 operator 先判断健康度，再决定是否进入对账调查。"
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
        eyebrow="Capital Pulse"
        title="资金责任面"
        description="把 Consumer、Platform、Provider 三侧的今日资金活动拉到同一层，先看责任面，再看总账与调查证据。"
        lanes={capitalPulseLanes}
        stamp={overview.projectedAt}
      />

      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <SurfaceCard eyebrow="Treasury Delta" title="总账差额判断" description="Finance 页负责回答资金是否健康，而不是解释差额为什么出现。差额解释统一进入 reconciliation。" stamp={overview.projectedAt ?? "live"}>
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

        <SurfaceCard eyebrow="Flow Volume" title="充值与出账规模" description="把全链路的流入、扣费、退款和提现规模集中呈现，作为总账判断的第二层上下文。" stamp={overview.projectedAt ?? "live"}>
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
        <SurfaceCard eyebrow="Finance Trend" title="流量趋势视图" description="趋势留在 Finance，但它只服务于总账判断，不承担调查证据角色。" stamp={overview.projectedAt ?? "live"}>
          <Box h="320px">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(99,92,82,0.10)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#635c52", fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "#635c52", fontSize: 12 }} width={44} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "18px",
                    border: "1px solid rgba(99,92,82,0.12)",
                    background: "rgba(255,255,255,0.96)",
                    boxShadow: "0 16px 42px rgba(23, 19, 17, 0.10)",
                  }}
                />
                <Line type="monotone" dataKey="deposit" stroke="#1f9257" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="charge" stroke="#0f1115" strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="refund" stroke="#f36a1d" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="withdrawal" stroke="#b83131" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </SurfaceCard>

        <SurfaceCard eyebrow="Operational Pressure" title="处置压力与跳转" description="这一组直接读取 gateway-admin 的资金压力读模型，不再由前端拼接或猜测。">
          <Stack gap="12px">
            <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
              <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">Vault delta signal</Text>
              <Stack mt="10px" direction="row" align="center" justify="space-between">
                <Heading size="md">{formatUsdc(overview.vaultLedgerDeltaUsdc)} USDC</Heading>
                <SentinelStatusChip label={getVaultDeltaTone(overview.vaultLedgerDeltaUsdc).toUpperCase()} tone={getVaultDeltaTone(overview.vaultLedgerDeltaUsdc)} />
              </Stack>
              <Text mt="8px" color="ink.500">偏差判断成立后，进入 Reconciliation 页面查看证据和排障上下文。</Text>
              <Link href="/finance/reconciliation"><Button mt="12px" size="sm" borderRadius="full">查看对账明细</Button></Link>
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

            <Link href="/withdrawal-reviews"><Button borderRadius="full" bg="brand.500" color="white" _hover={{ bg: "brand.600" }}>打开提现审核工作台</Button></Link>
          </Stack>
        </SurfaceCard>
      </Grid>

      <SurfaceCard eyebrow="Finance Queue" title="相关审批单" description="把退款、提现、异常入账等和 finance 相关的审批直接暴露在同一页。">
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
                <Td><SentinelStatusChip label={getApprovalStatusLabel(item.status)} tone={toneFromStatus(item.status)} /></Td>
                <Td>{formatDateTime(item.createdAt)}</Td>
              </Box>
            ))}
          </TableBody>
        </DataTable>
      </SurfaceCard>
    </AdminShell>
  );
}
