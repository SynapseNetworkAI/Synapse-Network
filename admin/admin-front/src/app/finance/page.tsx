"use client";

import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { DataTable, MessageBanner, MetricCard, MetricLabelWithHint, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th } from "@/components/console-ui";
import { formatDateTime, formatUsdc, toneFromStatus } from "@/lib/admin-console";
import { getApprovalStatusLabel, getApprovalTypeLabel } from "@/features/approval/approval-presenters";
import { buildFinanceExposureCards, buildTrendChartData, filterFinanceApprovals, getVaultDeltaTone } from "@/features/finance/finance-presenters";
import { getFinanceMetricGlossary } from "@/features/finance/finance-glossary";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  getActivityTrends,
  getFinanceOverview,
  listApprovals,
  type ApprovalItem,
  type ActivityTrendPoint,
  type FinanceOverview,
} from "@/services/admin-api";


export default function FinancePage() {
  const { admin, token, loading } = useAdminSession();
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [trendPoints, setTrendPoints] = useState<ActivityTrendPoint[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chartData = useMemo(() => buildTrendChartData(trendPoints), [trendPoints]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    async function load() {
      try {
        const [finance, approvalQueue, activityTrends] = await Promise.all([
          getFinanceOverview(activeToken),
          listApprovals(activeToken, { limit: 12 }),
          getActivityTrends(activeToken),
        ]);
        if (!cancelled) {
          setOverview(finance);
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
        title="资金运营中心"
        description="围绕充值、退款、提现和账本偏差建立受控操作台，避免财务动作直接撞主交易库。"
      >
        {error ? <MessageBanner kind="error" message={error} /> : <MessageBanner kind="error" message="资金运营视图暂时不可用。" />}
      </AdminShell>
    );
  }

  const exposureCards = buildFinanceExposureCards(overview);

  return (
    <AdminShell
      admin={admin}
      eyebrow="Finance Admin"
      title="资金运营中心"
      description="围绕充值、退款、提现和账本偏差建立受控操作台，避免财务动作直接撞主交易库。"
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label={<MetricLabelWithHint label={getFinanceMetricGlossary("todayDeposit").label} hint={getFinanceMetricGlossary("todayDeposit").hint} />} value={formatUsdc(overview.todayDepositUsdc)} meta={getFinanceMetricGlossary("todayDeposit").meta} />
        <MetricCard label={<MetricLabelWithHint label={getFinanceMetricGlossary("todayCharge").label} hint={getFinanceMetricGlossary("todayCharge").hint} />} value={formatUsdc(overview.todayChargeUsdc)} meta={getFinanceMetricGlossary("todayCharge").meta} />
        <MetricCard label={<MetricLabelWithHint label={getFinanceMetricGlossary("todayRefund").label} hint={getFinanceMetricGlossary("todayRefund").hint} />} value={formatUsdc(overview.todayRefundUsdc)} meta={getFinanceMetricGlossary("todayRefund").meta} />
        <MetricCard label={<MetricLabelWithHint label={getFinanceMetricGlossary("pendingWithdrawals").label} hint={getFinanceMetricGlossary("pendingWithdrawals").hint} />} value={overview.pendingWithdrawalCount} meta={getFinanceMetricGlossary("pendingWithdrawals").meta} />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1.15fr 0.85fr" }} gap="16px">
        <SurfaceCard eyebrow="Flow Window" title="资金趋势视图" description="把充值、扣费、退款和提现放进同一条资金流时间轴，让 operator 先看流向，再决定要不要深入审批或排错。" stamp={overview.projectedAt ?? "live"}>
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

        <SurfaceCard eyebrow="Controlled Actions" title="受控动作入口" description="金融动作要么走审批，要么走专用工作台，不能直接改资金真相表。" stamp={overview.projectedAt ?? "live"}>
          <Stack gap="12px">
            <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
              <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">Vault delta signal</Text>
              <Stack mt="10px" direction="row" align="center" justify="space-between">
                <Heading size="md">{formatUsdc(overview.vaultLedgerDeltaUsdc)} USDC</Heading>
                <SentinelStatusChip label={getVaultDeltaTone(overview.vaultLedgerDeltaUsdc).toUpperCase()} tone={getVaultDeltaTone(overview.vaultLedgerDeltaUsdc)} />
              </Stack>
              <Text mt="8px" color="ink.500">{getFinanceMetricGlossary("vaultLedgerDelta").hint}</Text>
              <Link href="/finance/reconciliation"><Button mt="12px" size="sm" borderRadius="full">查看对账明细</Button></Link>
            </Box>
            {[
              ["充值异常定位", "定位 deposit intent 未入账、链上确认延迟和 backfill 回放问题。"],
              ["退款审批", "对接 refund_approve 审批命令，避免未复核直接出账。"],
              ["提现审核", "大额或高风险提现进入 withdrawal reviews 专用工作台。"],
              ["冻结 / 解冻", "后续接入受控 gateway 命令，不让浏览器直写资金状态。"],
            ].map(([title, description]) => (
              <Box key={title} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Heading size="sm">{title}</Heading>
                <Text mt="8px" color="ink.500">{description}</Text>
              </Box>
            ))}
            <Link href="/withdrawal-reviews"><Button borderRadius="full" bg="brand.500" color="white" _hover={{ bg: "brand.600" }}>打开提现审核工作台</Button></Link>
          </Stack>
        </SurfaceCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "0.92fr 1.08fr" }} gap="16px">
        <SurfaceCard eyebrow="Balance Surfaces" title="资金暴露面" description="把 owner liability、provider payable 和 fee pool 固定在一个视图里，finance operator 才能快速知道该去哪层排查。">
          <Stack gap="12px">
            {exposureCards.map((card) => (
              <Box key={card.key} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Box fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">
                  <MetricLabelWithHint label={card.label} hint={card.hint} />
                </Box>
                <Heading mt="8px" size="md">{formatUsdc(card.value)} USDC</Heading>
                <Text mt="8px" color="ink.500">{card.description}</Text>
              </Box>
            ))}
            <Box borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
              <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">Queue counters</Text>
              <Text mt="8px" color="ink.500">{getFinanceMetricGlossary("pendingDeposits").label}: {overview.pendingDepositCount}</Text>
              <Text mt="6px" color="ink.500">{getFinanceMetricGlossary("pendingWithdrawals").label}: {overview.pendingWithdrawalCount}</Text>
              <Text mt="6px" color="ink.500">{getFinanceMetricGlossary("todayWithdrawal").label}: {formatUsdc(overview.todayWithdrawalUsdc)} USDC</Text>
            </Box>
          </Stack>
        </SurfaceCard>

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
      </Grid>
    </AdminShell>
  );
}