"use client";

import { Box, Heading, Stack, Text } from "@chakra-ui/react";

import { SentinelStatusChip, SurfaceCard } from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import type { SystemStatus } from "@/services/admin-api";

import {
  getRuntimeTone,
  type buildRuntimeCards,
  type buildSystemMetrics,
} from "./system-presenters";

type RuntimeCard = ReturnType<typeof buildRuntimeCards>[number];
type SystemMetrics = ReturnType<typeof buildSystemMetrics>;

export function RuntimeSnapshotPanel({
  metrics,
  runtimeCards,
  status,
}: Readonly<{
  metrics: SystemMetrics | null;
  runtimeCards: RuntimeCard[];
  status: SystemStatus;
}>) {
  return (
    <SurfaceCard
      eyebrow="Runtime Snapshot"
      title="组件运行快照"
      description="这里提供 gateway 真实任务状态、最近处理时间和失败信号，同时保留聚合投影时间供交叉核对。"
    >
      <Stack direction="row" gap="10px" mb="16px" flexWrap="wrap">
        <SentinelStatusChip
          label={`gateway ${status.gateway}`}
          tone={getRuntimeTone(status.gateway)}
        />
        <SentinelStatusChip
          label={`admin ${status.gatewayAdmin}`}
          tone={getRuntimeTone(status.gatewayAdmin)}
        />
      </Stack>
      <Stack gap="12px">
        {runtimeCards.map((card) => (
          <RuntimeSnapshotCard card={card} key={card.key} />
        ))}
        <FailureCounters metrics={metrics} />
      </Stack>
    </SurfaceCard>
  );
}

function RuntimeSnapshotCard({ card }: Readonly<{ card: RuntimeCard }>) {
  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Text
        fontSize="11px"
        letterSpacing="0.16em"
        textTransform="uppercase"
        color="ink.500"
      >
        {card.label}
      </Text>
      <Heading mt="10px" size="sm">
        {card.format === "datetime" ? formatDateTime(card.value) : card.value}
      </Heading>
      <Text mt="8px" color="ink.500">
        {card.description}
      </Text>
    </Box>
  );
}

function FailureCounters({
  metrics,
}: Readonly<{ metrics: SystemMetrics | null }>) {
  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Text
        fontSize="11px"
        letterSpacing="0.16em"
        textTransform="uppercase"
        color="ink.500"
      >
        Failure counters
      </Text>
      <Text mt="10px" color="ink.500">
        Gateway failures: {metrics?.recentGatewayFailures ?? 0}
      </Text>
      <Text mt="6px" color="ink.500">
        Failed deposits: {metrics?.failedDepositCount ?? 0}
      </Text>
      <Text mt="6px" color="ink.500">
        Audit alerts: {metrics?.recentAuditAlerts ?? 0}
      </Text>
    </Box>
  );
}
