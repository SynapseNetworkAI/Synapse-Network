"use client";

import { Grid } from "@chakra-ui/react";

import { MetricCard } from "@/components/console-ui";

import type { buildRiskMetrics } from "./risk-presenters";

export function RiskSummary({
  metrics,
}: Readonly<{ metrics: ReturnType<typeof buildRiskMetrics> }>) {
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
        label="Risk queue"
        value={metrics.total}
        meta="L2/L3 or finance-sensitive approval projections"
      />
      <MetricCard
        label="L3 alerts"
        value={metrics.red}
        meta="highest-risk approvals needing fastest response"
      />
      <MetricCard
        label="L2 warnings"
        value={metrics.yellow}
        meta="operator-visible degraded but not critical"
      />
      <MetricCard
        label="Under review"
        value={metrics.underReview}
        meta={`${metrics.submitted} still waiting to be picked up`}
      />
    </Grid>
  );
}
