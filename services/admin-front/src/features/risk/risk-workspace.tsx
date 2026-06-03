"use client";

import { Grid, Stack } from "@chakra-ui/react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { useAdminSession } from "@/lib/use-admin-session";
import type { AdminProfile } from "@/services/admin-api";

import { RiskApprovalQueue } from "./risk-approval-queue";
import { RiskPolicyDomains } from "./risk-policy-domains";
import { RiskSummary } from "./risk-summary";
import { useRiskApprovals } from "./use-risk-approvals";

export function RiskWorkspace() {
  const { admin, token, loading } = useAdminSession();
  const risk = useRiskApprovals(token);

  if (loading || !admin) {
    return (
      <ControlPlaneLoadingScreen
        title="Risk Console Warmup"
        message="正在构建风控工作台..."
      />
    );
  }

  return <RiskShell admin={admin} risk={risk} />;
}

function RiskShell({
  admin,
  risk,
}: Readonly<{
  admin: AdminProfile;
  risk: ReturnType<typeof useRiskApprovals>;
}>) {
  return (
    <AdminShell
      admin={admin}
      eyebrow="Risk Console"
      title="风控工作台"
      description="风险标签、阈值策略和异常资金动作不应该散在脚本里，而应该进入后台控制面编排。"
    >
      <Stack gap="16px">
        {risk.error ? (
          <MessageBanner kind="error" message={risk.error} />
        ) : null}
        <RiskSummary metrics={risk.metrics} />
        <Grid templateColumns={{ base: "1fr", xl: "0.88fr 1.12fr" }} gap="16px">
          <RiskPolicyDomains />
          <RiskApprovalQueue
            levelFilter={risk.levelFilter}
            riskItems={risk.riskItems}
            search={risk.search}
            setLevelFilter={risk.setLevelFilter}
            setSearch={risk.setSearch}
            visibleRiskItems={risk.visibleRiskItems}
          />
        </Grid>
      </Stack>
    </AdminShell>
  );
}
