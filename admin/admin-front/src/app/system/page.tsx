"use client";

import { Box, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { MessageBanner, MetricCard, SentinelStatusChip, SurfaceCard } from "@/components/console-ui";
import { omitDiagnosticSignals } from "@/features/diagnostics/diagnostic-presenters";
import { formatDateTime } from "@/lib/admin-console";
import { useDiagnosticsSnapshot } from "@/lib/use-diagnostics-snapshot";
import {
  buildRuntimeCards,
  buildSystemMetrics,
  getRuntimeTone,
} from "@/features/system/system-presenters";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  getOperationsOverview,
  getSystemStatus,
  type OperationsOverview,
  type SystemStatus,
} from "@/services/admin-api";


export default function SystemPage() {
  const { admin, token, loading } = useAdminSession();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [operations, setOperations] = useState<OperationsOverview | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { diagnostics, diagnosticError } = useDiagnosticsSnapshot(token, {
    suppressInitialLoading: true,
    loadErrorMessage: "加载共享诊断快照失败",
  });
  const metrics = useMemo(() => {
    if (!status || !operations) {
      return null;
    }
    return buildSystemMetrics(status, operations);
  }, [operations, status]);
  const runtimeCards = useMemo(() => {
    if (!operations) {
      return [];
    }
    return buildRuntimeCards(operations);
  }, [operations]);
  const systemDiagnostics = useMemo(() => omitDiagnosticSignals(diagnostics, ["reconciliation"]), [diagnostics]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    async function load() {
      try {
        const [systemStatus, operationsOverview] = await Promise.all([
          getSystemStatus(activeToken),
          getOperationsOverview(activeToken),
        ]);
        if (!cancelled) {
          setStatus(systemStatus);
          setOperations(operationsOverview);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载系统运维模块失败");
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
    return <ControlPlaneLoadingScreen title="Runtime Snapshot Sync" message="正在同步系统运行状态..." />;
  }

  if (!status || !operations) {
    return (
      <AdminShell
        admin={admin}
        eyebrow="System Control"
        title="系统运维中心"
        description="这里负责查看 gateway 相关运行快照、执行异常和投影新鲜度；当前 indexer / backfill / reconciliation 展示的是 runtime projection proxy，不是独立任务监控台。"
      >
        {error ? <MessageBanner kind="error" message={error} /> : <MessageBanner kind="error" message="系统运行视图暂时不可用。" />}
      </AdminShell>
    );
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="System Control"
      title="系统运维中心"
      description="这里负责查看 gateway 相关运行快照、执行异常和投影新鲜度；当前 indexer / backfill / reconciliation 展示的是 runtime projection proxy，不是独立任务监控台。"
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label="Admin 控制面" value={metrics?.gatewayAdmin ?? "n/a"} meta="后台控制面可用性" />
        <MetricCard label="Gateway 运行面" value={metrics?.gateway ?? "n/a"} meta="交易网关运行可用性" />
        <MetricCard label="审批队列深度" value={metrics?.approvalQueueDepth ?? 0} meta="待 reviewer 处理项目" />
      </Grid>
      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <SurfaceCard eyebrow="Runtime Snapshot" title="组件运行快照" description="这里提供 gateway 运行快照与 projection freshness 线索，不再把它表述成独立任务监控。">
          <Stack direction="row" gap="10px" mb="16px" flexWrap="wrap">
            <SentinelStatusChip label={`gateway ${status.gateway}`} tone={getRuntimeTone(status.gateway)} />
            <SentinelStatusChip label={`admin ${status.gatewayAdmin}`} tone={getRuntimeTone(status.gatewayAdmin)} />
          </Stack>
          <Stack gap="12px">
            {runtimeCards.map((card) => (
              <Box key={card.key} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{card.label}</Text>
                <Heading mt="10px" size="sm">{card.format === "datetime" ? formatDateTime(card.value) : card.value}</Heading>
                <Text mt="8px" color="ink.500">{card.description}</Text>
              </Box>
            ))}
            <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
              <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Failure counters</Text>
              <Text mt="10px" color="ink.500">Gateway failures: {metrics?.recentGatewayFailures ?? 0}</Text>
              <Text mt="6px" color="ink.500">Failed deposits: {metrics?.failedDepositCount ?? 0}</Text>
              <Text mt="6px" color="ink.500">Audit alerts: {metrics?.recentAuditAlerts ?? 0}</Text>
            </Box>
          </Stack>
        </SurfaceCard>
        <DiagnosticsPanel
          eyebrow="共享诊断"
          title="系统诊断明细"
          descriptionFallback="这里提供完整 diagnostics 结论与组件级调查线索；dashboard 页面只保留摘要，不在那边重复展开。"
          diagnostics={systemDiagnostics}
          error={diagnosticError}
          statusHint="与 dashboard 概览和系统入口共享同一诊断源；这里展示真实后台执行失败、审批压力与投影快照，但不是独立任务监控控制台。"
          actionColumnsMd={2}
          cardRadius="20px"
          cardPadding="16px"
          cardBackground="rgba(255,255,255,0.74)"
          cardBorder="1px solid rgba(99,92,82,0.10)"
          signalHeadingSize="sm"
          extraContent={operations.reconciliationLastError ? (
              <Box borderRadius="20px" p="16px" bg="rgba(184, 49, 49, 0.10)" border="1px solid rgba(184, 49, 49, 0.16)">
                <Heading size="sm" color="#8f1d1d">最近一次对账错误</Heading>
                <Text mt="8px" color="#8f1d1d">{operations.reconciliationLastError}</Text>
              </Box>
            ) : null}
        />
      </Grid>
    </AdminShell>
  );
}