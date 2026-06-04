import { Grid } from "@chakra-ui/react";

import { MetricCard } from "@/components/console-ui";

import type { useReviewHistory } from "./use-review-history";

type ReviewHistoryMetrics = ReturnType<typeof useReviewHistory>["metrics"];

export function ReviewHistoryMetricGrid({
  metrics,
}: Readonly<{ metrics: ReviewHistoryMetrics }>) {
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
        label="审核记录"
        value={metrics.total}
        meta="已完成 reviewer 决策的提现单"
      />
      <MetricCard
        label="放行记录"
        value={metrics.approved}
        meta={`${metrics.completed} 笔已继续走到完成`}
      />
      <MetricCard
        label="驳回记录"
        value={metrics.rejected}
        meta="被 reviewer 明确拒绝"
        accent="linear-gradient(180deg, rgba(255,243,240,0.98) 0%, rgba(255,232,226,0.96) 100%)"
      />
      <MetricCard
        label="已释放"
        value={metrics.cancelled}
        meta="已从锁定态释放回可用余额"
      />
    </Grid>
  );
}
