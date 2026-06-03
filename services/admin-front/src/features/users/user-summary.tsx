"use client";

import { Grid } from "@chakra-ui/react";

import { MetricCard } from "@/components/console-ui";

import type { AdminUserMetrics } from "./user-presenters";

export function UserSummary({
  metrics,
}: Readonly<{ metrics: AdminUserMetrics }>) {
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
        label="Total operators"
        value={metrics.total}
        meta="directory entries across all role templates"
      />
      <MetricCard
        label="Active operators"
        value={metrics.active}
        meta="enabled for active console sessions"
      />
      <MetricCard
        label="MFA enforced"
        value={metrics.requireMfa}
        meta="Google Authenticator required"
      />
      <MetricCard
        label="Privileged roles"
        value={metrics.privileged}
        meta="finance / review / super admin surfaces"
      />
    </Grid>
  );
}
