"use client";

import { Box, Button, Grid, Heading, HStack, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AdminShell } from "@/components/admin-shell";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { DataTable, EmptyBlock, MessageBanner, MetricCard, SentinelStatusChip, StatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th } from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import { useDiagnosticsSnapshot } from "@/lib/use-diagnostics-snapshot";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  buildCapitalSnapshotCards,
  buildOperationsItems,
  buildRiskActivityRows,
  buildSentinelMetrics,
  resolveProjectionNarrative,
  resolveReadModelTimestamp,
} from "@/features/dashboard/dashboard-presenters";
import {
  getActivityTrends,
  getDashboardOverview,
  getFinanceOverview,
  getOperationsOverview,
  getSystemStatus,
  listApprovals,
  type ApprovalItem,
  type ActivityTrendSeries,
  type DashboardOverview,
  type FinanceOverview,
  type OperationsOverview,
  type SystemStatus,
} from "@/services/admin-api";

export default function DashboardPage() {
  const { admin, token, loading } = useAdminSession();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [financeOverview, setFinanceOverview] = useState<FinanceOverview | null>(null);
  const [activityTrends, setActivityTrends] = useState<ActivityTrendSeries | null>(null);
  const [operationsOverview, setOperationsOverview] = useState<OperationsOverview | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { diagnostics, diagnosticError, diagnosticsLoading, refreshDiagnostics } = useDiagnosticsSnapshot(token, {
    suppressInitialLoading: true,
    loadErrorMessage: "加载系统诊断失败",
  });
  const chartData = useMemo(() => {
    return activityTrends?.points.map((point) => ({
      label: point.bucketDate.slice(5),
      charge: Number(point.chargeUsdc),
      deposit: Number(point.depositUsdc),
      withdrawal: Number(point.withdrawalUsdc),
      net: Number(point.netFlowUsdc),
    })) ?? [];
  }, [activityTrends]);

  const sentinelMetrics = useMemo(() => {
    return buildSentinelMetrics(overview, operationsOverview);
  }, [operationsOverview, overview]);

  const operationsItems = useMemo(() => {
    return buildOperationsItems(systemStatus, operationsOverview);
  }, [operationsOverview, systemStatus]);

  const riskActivityRows = useMemo(() => {
    return buildRiskActivityRows(approvals);
  }, [approvals]);

  const capitalCards = useMemo(() => buildCapitalSnapshotCards(financeOverview), [financeOverview]);

  const readModelTimestamp = useMemo(() => {
    return resolveReadModelTimestamp(financeOverview, operationsOverview, systemStatus);
  }, [financeOverview, operationsOverview, systemStatus]);

  const projectionNarrative = useMemo(() => {
    return resolveProjectionNarrative(overview, activityTrends, operationsOverview);
  }, [activityTrends, operationsOverview, overview]);

  useEffect(() => {
    if (!token || !admin) {
      return;
    }
    const activeToken = token;

    let cancelled = false;

    async function load() {
      try {
        const [dashboardOverview, status, finance, trends, operations, approvalQueue] = await Promise.all([
          getDashboardOverview(activeToken),
          getSystemStatus(activeToken),
          getFinanceOverview(activeToken),
          getActivityTrends(activeToken),
          getOperationsOverview(activeToken),
          listApprovals(activeToken, { limit: 8 }),
          refreshDiagnostics(activeToken, { silent: true }),
        ]);
        if (cancelled) {
          return;
        }
        setOverview(dashboardOverview);
        setSystemStatus(status);
        setFinanceOverview(finance);
        setActivityTrends(trends);
        setOperationsOverview(operations);
        setApprovals(approvalQueue.items);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载控制台失败");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [admin, refreshDiagnostics, token]);

  if (loading) {
    return <main className="state-screen">正在连接 gateway-admin 控制面...</main>;
  }

  if (!admin) {
    return null;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow=""
      title=""
      description=""
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}

      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        {sentinelMetrics.map((metric, index) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            meta={metric.meta}
            href={metric.href}
            actionLabel={metric.actionLabel}
            accent={index === 0 ? "linear-gradient(180deg, #ffffff 0%, #edf8f1 100%)" : undefined}
          />
        ))}
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1.15fr 0.85fr" }} gap="16px">
        <SurfaceCard eyebrow="Finance Overview" title="Finance Activity" description="以稳定读模型绘制充值、扣费和净流量走势，不在前端直接拼接真相表。" stamp="READ MODEL / 7D">
          {chartData.length > 0 ? (
            <Box h="320px">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid stroke="rgba(99,92,82,0.12)" vertical={false} />
                  <XAxis dataKey="label" stroke="#8f8677" />
                  <YAxis stroke="#8f8677" />
                  <Tooltip />
                  <Line type="monotone" dataKey="deposit" stroke="#1f9257" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="charge" stroke="#0f1115" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="net" stroke="#6b7785" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          ) : (
            <EmptyBlock title="Trend projection pending" description="当前没有可用的 activity trend 点位。" />
          )}
        </SurfaceCard>

        <SurfaceCard eyebrow="Operations Status" title="Node and subsystem posture" description="只显示值班最需要的四个运行态信号，用 Nominal 和 Degraded 标签快速切换决策焦点。">
          <Stack gap="12px">
            {operationsItems.map((item) => (
              (() => {
                let statusLabel = "Nominal";
                if (item.tone === "red") {
                  statusLabel = "Degraded";
                } else if (item.tone === "orange") {
                  statusLabel = "Active";
                }

                return (
              <Grid key={item.label} templateColumns="1fr auto" gap="12px" alignItems="center" borderRadius="18px" p="14px" bg="#f6f8fb" border="1px solid rgba(15,17,21,0.05)">
                <Stack gap="2px">
                  <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{item.label}</Text>
                  <Text fontWeight="700">{item.value}</Text>
                </Stack>
                <SentinelStatusChip label={statusLabel} tone={item.tone} />
              </Grid>
                );
              })()
            ))}
            <Box borderRadius="18px" p="14px" bg="#f6f8fb" border="1px solid rgba(15,17,21,0.05)">
              <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Latest projection markers</Text>
              <HStack mt="10px" gap="10px" wrap="wrap">
                <StatusChip value={`Indexer ${operationsOverview?.indexerLastProcessedAt ? formatDateTime(operationsOverview.indexerLastProcessedAt) : "n/a"}`} />
                <StatusChip value={`Failures ${operationsOverview?.recentGatewayFailures ?? 0}`} />
                <StatusChip value={`Queue ${systemStatus?.approvalQueueDepth ?? 0}`} />
              </HStack>
            </Box>
          </Stack>
        </SurfaceCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "0.9fr 1.1fr" }} gap="16px">
        <SurfaceCard eyebrow="Capital Snapshot" title="Capital posture" description="把资金快照拆成更接近控制面的卡片，而不是旧后台的线性指标堆叠。">
          <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="12px">
            {capitalCards.map(({ label, value }) => (
              <Box key={label} borderRadius="20px" p="16px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)">
                <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{label}</Text>
                <Heading mt="12px" size="md">{value}</Heading>
              </Box>
            ))}
          </Grid>
        </SurfaceCard>

        <SurfaceCard eyebrow="Risk Activity Stream" title="Recent approvals needing attention" description="把审批列表重新表达为 threat stream，便于值班模式快速判断严重级别和下一步动作。" actions={<Link href="/approvals"><Button size="sm" borderRadius="full">Open Approvals</Button></Link>}>
          <DataTable>
            <TableHeaderRow>
              <Th>Timestamp</Th>
              <Th>Vector ID</Th>
              <Th>Threat Level</Th>
              <Th>Source Origin</Th>
              <Th>Action</Th>
            </TableHeaderRow>
            <TableBody>
              {riskActivityRows.map((item) => {
                let threatTone: "green" | "orange" | "red" | "gray" = "gray";
                if (item.threatLevel === "critical") {
                  threatTone = "red";
                } else if (item.threatLevel === "elevated") {
                  threatTone = "orange";
                }

                return (
                  <Box as="tr" key={item.approvalId}>
                    <Td>{item.createdAt}</Td>
                    <Td>
                      <Text fontWeight="700">{item.approvalId}</Text>
                    </Td>
                    <Td>
                      <SentinelStatusChip label={item.threatLevel} tone={threatTone} />
                    </Td>
                    <Td>{item.source}</Td>
                    <Td>{item.actionTaken}</Td>
                  </Box>
                );
              })}
            </TableBody>
          </DataTable>
        </SurfaceCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1.1fr 0.9fr" }} gap="16px">
        <DiagnosticsPanel
          eyebrow="Diagnostic Actions"
          title="Run controlled next steps"
          descriptionFallback="Sentinel 首页不仅显示数字，也给出明确的系统诊断和模块跳转入口。"
          diagnostics={diagnostics}
          error={diagnosticError}
          primaryAction={(
            <Button
              alignSelf="flex-start"
              size="lg"
              borderRadius="full"
              bg="#0f1115"
              color="#f4f7fb"
              _hover={{ bg: "#1b1f26" }}
              onClick={() => token ? void refreshDiagnostics(token) : undefined}
              loading={diagnosticsLoading}
              loadingText="Running"
            >
              Run System Diagnostic
            </Button>
          )}
        />

        <SurfaceCard eyebrow="Sentinel Footer" title="Stable read model marker" description="让值班人员明确当前看到的是哪一个投影视图时间点，而不是不透明的实时态。">
          <Stack gap="14px">
            <Box borderRadius="22px" p="18px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)">
              <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Current timestamp</Text>
              <Heading mt="10px" size="lg">{readModelTimestamp}</Heading>
            </Box>
            <Box borderRadius="22px" p="18px" bg="#0f1115" color="#f4f7fb">
              <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="rgba(244,247,251,0.56)">Projection identifier</Text>
              <Heading mt="10px" size="md">GATEWAY ADMIN PROJECTION</Heading>
              <Text mt="8px" color="rgba(244,247,251,0.68)">{projectionNarrative}</Text>
            </Box>
          </Stack>
        </SurfaceCard>
      </Grid>
    </AdminShell>
  );
}
