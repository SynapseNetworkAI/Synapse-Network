"use client";

import { Grid, Stack } from "@chakra-ui/react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { useAdminSession } from "@/lib/use-admin-session";
import type { AdminProfile } from "@/services/admin-api";

import { AuditInsightsPanel } from "./audit-insights-panel";
import { AuditLedgerTable } from "./audit-ledger-table";
import { AuditSummary } from "./audit-summary";
import { useAuditLedger } from "./use-audit-ledger";

export function AuditWorkspace() {
  const { admin, token, loading } = useAdminSession();
  const audit = useAuditLedger(token);

  if (loading || !admin) {
    return (
      <ControlPlaneLoadingScreen
        title="Audit Trail Retrieval"
        message="正在检索审计链路..."
      />
    );
  }

  return <AuditShell admin={admin} audit={audit} />;
}

function AuditShell({
  admin,
  audit,
}: Readonly<{
  admin: AdminProfile;
  audit: ReturnType<typeof useAuditLedger>;
}>) {
  return (
    <AdminShell
      admin={admin}
      eyebrow="Audit & Compliance"
      title="操作日志与审计追踪"
      description="关键资金动作、后台用户变更和审批决策统一落审计，避免控制面成为黑盒。"
    >
      <Stack gap="16px">
        {audit.error ? (
          <MessageBanner kind="error" message={audit.error} />
        ) : null}
        <AuditSummary metrics={audit.metrics} />
        <Grid templateColumns={{ base: "1fr", xl: "1.08fr 0.92fr" }} gap="16px">
          <AuditLedgerTable
            items={audit.visibleItems}
            search={audit.search}
            setSearch={audit.setSearch}
            setStatusFilter={audit.setStatusFilter}
            statusFilter={audit.statusFilter}
            statuses={audit.statuses}
            totalItems={audit.items.length}
          />
          <AuditInsightsPanel errorCodes={audit.errorCodes} />
        </Grid>
      </Stack>
    </AdminShell>
  );
}
