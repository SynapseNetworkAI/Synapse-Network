"use client";

import { Grid } from "@chakra-ui/react";

import { MetricCard } from "@/components/console-ui";
import { formatUsdc } from "@/lib/admin-console";

import type { buildApprovalMetrics } from "./approval-presenters";

export function ApprovalSummary({
  metrics,
}: Readonly<{ metrics: ReturnType<typeof buildApprovalMetrics> }>) {
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
        label="Queue depth"
        value={metrics.total}
        meta="all approval projections in one queue"
      />
      <MetricCard
        label="Projected withdrawals"
        value={metrics.projectedWithdrawCount}
        meta={`${formatUsdc(
          metrics.projectedWithdrawAmount
        )} USDC under review`}
      />
      <MetricCard
        label="L3 hot items"
        value={metrics.l3Count}
        meta="highest-risk approvals needing fast review"
      />
      <MetricCard
        label="Pending execution"
        value={metrics.pendingExecutionCount}
        meta="approved but not yet executed"
      />
    </Grid>
  );
}
