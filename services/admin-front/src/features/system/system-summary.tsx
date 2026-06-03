"use client";

import { Grid } from "@chakra-ui/react";

import { MetricCard } from "@/components/console-ui";

import type { buildSystemMetrics } from "./system-presenters";

export function SystemSummary({
  metrics,
}: Readonly<{ metrics: ReturnType<typeof buildSystemMetrics> | null }>) {
  return (
    <Grid
      templateColumns={{
        base: "1fr",
        md: "repeat(2, 1fr)",
        xl: "repeat(4, 1fr)",
      }}
      gap="16px"
    >
      <MetricCard
        label="Admin 控制面"
        value={metrics?.gatewayAdmin ?? "n/a"}
        meta="后台控制面可用性"
      />
      <MetricCard
        label="Gateway 运行面"
        value={metrics?.gateway ?? "n/a"}
        meta="交易网关运行可用性"
      />
      <MetricCard
        label="审批队列深度"
        value={metrics?.approvalQueueDepth ?? 0}
        meta="待 reviewer 处理项目"
      />
    </Grid>
  );
}
