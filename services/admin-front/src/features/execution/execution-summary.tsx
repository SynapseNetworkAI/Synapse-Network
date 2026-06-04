"use client";

import { Grid } from "@chakra-ui/react";

import { MetricCard } from "@/components/console-ui";

import type { buildExecutionMetrics } from "./execution-presenters";

export function ExecutionSummary({
  metrics,
}: Readonly<{ metrics: ReturnType<typeof buildExecutionMetrics> }>) {
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
        label="执行任务总数"
        value={metrics.totalCount}
        meta="审批落地后的受控命令"
      />
      <MetricCard
        label="失败任务"
        value={metrics.failedCount}
        meta={`${metrics.retryableCount} 个仍可重试`}
        accent="linear-gradient(180deg, rgba(255,243,240,0.98) 0%, rgba(255,232,226,0.96) 100%)"
      />
      <MetricCard
        label="处理中任务"
        value={metrics.inflightCount}
        meta="排队、执行中或重试中"
        accent="linear-gradient(180deg, rgba(255,251,244,0.98) 0%, rgba(255,242,226,0.96) 100%)"
      />
      <MetricCard
        label="重试耗尽"
        value={metrics.exhaustedCount}
        meta={`${metrics.succeededCount} 个已经成功收口`}
      />
    </Grid>
  );
}
