"use client";

import { Grid } from "@chakra-ui/react";

import { MetricCard } from "@/components/console-ui";

import type { buildAuditMetrics } from "./audit-presenters";

export function AuditSummary({
  metrics,
}: Readonly<{ metrics: ReturnType<typeof buildAuditMetrics> }>) {
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
        label="Audit events"
        value={metrics.total}
        meta="immutable operator trail rows"
      />
      <MetricCard
        label="Failures"
        value={metrics.failed}
        meta="events with non-success result"
      />
      <MetricCard
        label="Approval-linked"
        value={metrics.approvalLinked}
        meta="events tied to approval decisions"
      />
      <MetricCard
        label="Execution-linked"
        value={metrics.executionLinked}
        meta="events tied to job execution"
      />
    </Grid>
  );
}
