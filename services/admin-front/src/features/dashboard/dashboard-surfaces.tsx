"use client";

import { Box, Button, Grid, Heading, HStack, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { DataTable, MetricCard, MetricLabelWithHint, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th } from "@/components/console-ui";
import { buildPrioritizedDiagnosticSignalCards, getDiagnosticStatusLabel, getDiagnosticSummaryText } from "@/features/diagnostics/diagnostic-presenters";
import { formatDateTime } from "@/lib/admin-console";
import type { DashboardDiagnostics, OperationsOverview, SystemStatus } from "@/services/admin-api";

function resolveToneLabel(tone: "green" | "orange" | "red" | "gray"): string {
  if (tone === "red") {
    return "需处理";
  }

  if (tone === "orange") {
    return "需关注";
  }

  if (tone === "green") {
    return "正常";
  }

  return "待确认";
}

type DashboardSentinelMetric = {
  label: string;
  value: string;
  meta: string;
  href?: string;
  actionLabel?: string;
};

type DashboardFlowCard = {
  key: string;
  label: string;
  value: string;
  hint: string;
};

type DashboardPressureCard = {
  key: string;
  label: string;
  value: string;
  hint: string;
};

type DashboardFunnelCard = {
  key: string;
  title: string;
  value: string;
  detail: string;
  tone: "green" | "orange" | "red" | "gray";
  href?: string;
};

type DashboardOperationsItem = {
  label: string;
  value: string;
  tone: "green" | "orange" | "red";
};

type DashboardRiskActivityRow = {
  approvalId: string;
  createdAt: string;
  threatLevel: string;
  source: string;
  actionTaken: string;
};

type DashboardRuntimeCard = {
  key: string;
  label: string;
  value: string;
  description: string;
  format: "datetime" | "text";
};

type DashboardBusinessLaneCard = {
  key: string;
  title: string;
  summary: string;
  detail: string;
  tone: "green" | "orange" | "red" | "gray";
  href: string;
  actionLabel: string;
};

export function DashboardSentinelMetricsGrid({ metrics }: Readonly<{ metrics: DashboardSentinelMetric[] }>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
      {metrics.map((metric, index) => (
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
  );
}

export function DashboardDiagnosticsSurface({
  diagnostics,
  diagnosticError,
  diagnosticsLoading,
  onRefresh,
  funnelCards,
  title = "首页重点提醒",
  descriptionFallback = "这里集中展示当前整体状态、建议动作和三类核心业务摘要，帮助业务人员快速判断优先级。",
}: Readonly<{
  diagnostics: DashboardDiagnostics | null;
  diagnosticError?: string | null;
  diagnosticsLoading: boolean;
  onRefresh: () => void;
  funnelCards: DashboardFunnelCard[];
  title?: string;
  descriptionFallback?: string;
}>) {
  return (
    <DiagnosticsPanel
      eyebrow="首页提醒"
      title={title}
      descriptionFallback={descriptionFallback}
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
          onClick={onRefresh}
          loading={diagnosticsLoading}
          loadingText="刷新中"
        >
          刷新当前状态
        </Button>
      )}
      extraContent={(
        <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap="12px">
          {funnelCards.map((card) => (
            <Link key={card.key} href={card.href ?? "/dashboard"}>
              <Box borderRadius="22px" p="18px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)" h="100%">
                <HStack justify="space-between" align="flex-start" gap="10px">
                  <Stack gap="4px">
                    <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{card.title}</Text>
                    <Heading size="md">{card.value}</Heading>
                  </Stack>
                  <SentinelStatusChip label={resolveToneLabel(card.tone)} tone={card.tone} />
                </HStack>
                <Text mt="10px" color="ink.500">{card.detail}</Text>
              </Box>
            </Link>
          ))}
        </Grid>
      )}
    />
  );
}

export function DashboardFlowSnapshotSurface({ flowCards }: Readonly<{ flowCards: DashboardFlowCard[] }>) {
  return (
    <SurfaceCard eyebrow="今日资金变化" title="今日资金概览" description="这里用最简洁的方式展示今天的充值、扣费、退款和提现情况，便于快速判断业务节奏。">
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="12px">
        {flowCards.map(({ key, label, value, hint }) => (
          <Box key={key} borderRadius="20px" p="16px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)">
            <Box fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">
              <MetricLabelWithHint label={label} hint={hint} />
            </Box>
            <Heading mt="12px" size="md">{value}</Heading>
          </Box>
        ))}
      </Grid>
    </SurfaceCard>
  );
}

export function DashboardQueuePressureSurface({ pressureCards }: Readonly<{ pressureCards: DashboardPressureCard[] }>) {
  return (
    <SurfaceCard eyebrow="待处理事项" title="今日关注重点" description="把今天最需要业务人员关注的四类待处理事项直接展示出来，避免遗漏。">
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="12px">
        {pressureCards.map((card) => (
          <Box key={card.key} borderRadius="20px" p="16px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)">
            <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{card.label}</Text>
            <Heading mt="10px" size="md">{card.value}</Heading>
            <Text mt="8px" color="ink.500">{card.hint}</Text>
          </Box>
        ))}
      </Grid>
    </SurfaceCard>
  );
}

export function DashboardOperationsStatusSurface({
  operationsItems,
  operationsOverview,
  systemStatus,
  actions,
  title = "Node and subsystem posture",
  description = "把 gateway、queue、reconciliation 和投影标记压成一屏，帮助值班人员先判断应该去哪个页面。",
}: Readonly<{
  operationsItems: DashboardOperationsItem[];
  operationsOverview: OperationsOverview | null;
  systemStatus: SystemStatus | null;
  actions?: ReactNode;
  title?: string;
  description?: string;
}>) {
  return (
    <SurfaceCard eyebrow="Operations Status" title={title} description={description} actions={actions}>
      <Stack gap="12px">
        {operationsItems.map((item) => {
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
        })}
        <Box borderRadius="18px" p="14px" bg="#f6f8fb" border="1px solid rgba(15,17,21,0.05)">
          <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Latest projection markers</Text>
          <HStack mt="10px" gap="10px" wrap="wrap">
            <SentinelStatusChip label={`Indexer ${operationsOverview?.indexerLastProcessedAt ? formatDateTime(operationsOverview.indexerLastProcessedAt) : "n/a"}`} tone="gray" />
            <SentinelStatusChip label={`Failures ${operationsOverview?.recentGatewayFailures ?? 0}`} tone="gray" />
            <SentinelStatusChip label={`Queue ${systemStatus?.approvalQueueDepth ?? 0}`} tone="gray" />
          </HStack>
        </Box>
      </Stack>
    </SurfaceCard>
  );
}

export function DashboardRuntimeSnapshotSurface({
  runtimeCards,
  recentGatewayFailures,
  failedDepositCount,
  recentAuditAlerts,
  actions,
}: Readonly<{
  runtimeCards: DashboardRuntimeCard[];
  recentGatewayFailures: number;
  failedDepositCount: number;
  recentAuditAlerts: number;
  actions?: ReactNode;
}>) {
  return (
    <SurfaceCard eyebrow="Runtime Snapshot" title="补偿与对账投影" description="把 backfill、indexer、gateway failure 和 reconciliation 的稳定读模型统一拉平。" actions={actions}>
      <Stack gap="12px">
        {runtimeCards.map((card) => (
          <Box key={card.key} borderRadius="20px" p="16px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)">
            <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{card.label}</Text>
            <Heading mt="10px" size="sm">{card.format === "datetime" ? formatDateTime(card.value) : card.value}</Heading>
            <Text mt="8px" color="ink.500">{card.description}</Text>
          </Box>
        ))}
        <Box borderRadius="20px" p="16px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)">
          <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Failure counters</Text>
          <Text mt="10px" color="ink.500">Gateway failures: {recentGatewayFailures}</Text>
          <Text mt="6px" color="ink.500">Failed deposits: {failedDepositCount}</Text>
          <Text mt="6px" color="ink.500">Audit alerts: {recentAuditAlerts}</Text>
        </Box>
      </Stack>
    </SurfaceCard>
  );
}

export function DashboardThreatStreamSurface({ rows }: Readonly<{ rows: DashboardRiskActivityRow[] }>) {
  return (
    <SurfaceCard eyebrow="Threat Stream" title="高风险审批流" description="业务运行态只保留最值得值班员接手的审批异常流，帮助快速判断下一个人工处置入口。" actions={<Link href="/approvals"><Button size="sm" borderRadius="full">进入审批中心</Button></Link>}>
      <DataTable>
        <TableHeaderRow>
          <Th>时间</Th>
          <Th>审批单</Th>
          <Th>风险级别</Th>
          <Th>来源</Th>
          <Th>建议动作</Th>
        </TableHeaderRow>
        <TableBody>
          {rows.map((item) => {
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
  );
}

export function DashboardBusinessRuntimeSurface({ cards }: Readonly<{ cards: DashboardBusinessLaneCard[] }>) {
  return (
    <SurfaceCard eyebrow="Business Runtime" title="三条业务链路" description="这里只回答审批、充值、出账哪条链路在堵塞，不展示系统组件级明细，也不承载执行任务操作。">
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="12px">
        {cards.map((card) => (
          <Link key={card.key} href={card.href}>
            <Box borderRadius="22px" p="18px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)" h="100%">
              <HStack justify="space-between" align="flex-start" gap="12px">
                <Stack gap="4px">
                  <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{card.title}</Text>
                  <Heading size="sm">{card.summary}</Heading>
                </Stack>
                <SentinelStatusChip label={card.tone} tone={card.tone} />
              </HStack>
              <Text mt="8px" color="ink.500">{card.detail}</Text>
              <Text mt="12px" fontWeight="700" color="signal.700">{card.actionLabel}</Text>
            </Box>
          </Link>
        ))}
      </Grid>
    </SurfaceCard>
  );
}

export function DashboardHealthSummarySurface({
  diagnostics,
  diagnosticError,
  diagnosticsLoading,
  onRefresh,
  readModelTimestamp,
}: Readonly<{
  diagnostics: DashboardDiagnostics | null;
  diagnosticError?: string | null;
  diagnosticsLoading: boolean;
  onRefresh: () => void;
  readModelTimestamp: string;
}>) {
  const signalCards = buildPrioritizedDiagnosticSignalCards(diagnostics?.signals ?? [], 3);

  return (
    <SurfaceCard
      eyebrow="系统摘要"
      title="系统状态摘要"
      description="这里只保留系统整体结论和最关键提醒；如需进一步排查，再进入系统运维中心。"
      stamp={diagnostics?.checkedAt ? `已更新 ${formatDateTime(diagnostics.checkedAt)}` : readModelTimestamp}
      actions={
        <>
          <Button size="sm" borderRadius="full" variant="ghost" onClick={onRefresh} loading={diagnosticsLoading} loadingText="刷新中">
            刷新诊断
          </Button>
          <Link href="/system"><Button size="sm" borderRadius="full" bg="#0f1115" color="#f4f7fb" _hover={{ bg: "#1b1f26" }}>进入系统运维中心</Button></Link>
        </>
      }
    >
      <Stack gap="12px">
        {diagnosticError ? <Text color="#8f1d1d">{diagnosticError}</Text> : null}
        <Box borderRadius="20px" p="16px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)">
          <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">当前结论</Text>
          <Heading mt="10px" size="md">{getDiagnosticStatusLabel(diagnostics?.overallStatus)}</Heading>
          <Text mt="8px" color="ink.500">{getDiagnosticSummaryText(diagnostics?.summary) ?? "统一 diagnostics 语义层尚未返回最新系统结论。"}</Text>
        </Box>
        <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap="12px">
          {signalCards.map((signal) => (
            <Box key={signal.key} borderRadius="20px" p="16px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)">
              <HStack justify="space-between" align="flex-start" gap="12px">
                <Stack gap="4px">
                  <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{signal.label}</Text>
                  <Heading size="sm">{signal.value}</Heading>
                </Stack>
                <SentinelStatusChip label={getDiagnosticStatusLabel(signal.status)} tone={signal.tone} />
              </HStack>
              <Text mt="8px" color="ink.500">{signal.detail}</Text>
            </Box>
          ))}
        </Grid>
      </Stack>
    </SurfaceCard>
  );
}

export function DashboardProjectionMarkerSurface({
  readModelTimestamp,
  projectionNarrative,
  actions,
}: Readonly<{
  readModelTimestamp: string;
  projectionNarrative: string;
  actions?: ReactNode;
}>) {
  return (
    <SurfaceCard eyebrow="Sentinel Footer" title="Stable read model marker" description="让值班人员明确当前看到的是哪一个投影视图时间点，而不是不透明的实时态。" actions={actions}>
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
  );
}