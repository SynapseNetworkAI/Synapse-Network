"use client";

import { Grid, Stack } from "@chakra-ui/react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { useAdminSession } from "@/lib/use-admin-session";
import type { AdminProfile } from "@/services/admin-api";

import { ApprovalInsightsPanel } from "./approval-insights-panel";
import { ApprovalListWorkbench } from "./approval-list-workbench";
import { ApprovalSummary } from "./approval-summary";
import { useApprovalQueue } from "./use-approval-queue";

export function ApprovalsWorkspace() {
  const { admin, token, loading } = useAdminSession();
  const approvals = useApprovalQueue(token);

  if (loading || !admin) {
    return (
      <ControlPlaneLoadingScreen
        title="Approval Queue Projection"
        message="正在读取审批队列..."
      />
    );
  }

  return <ApprovalsShell admin={admin} approvals={approvals} />;
}

function ApprovalsShell({
  admin,
  approvals,
}: Readonly<{
  admin: AdminProfile;
  approvals: ReturnType<typeof useApprovalQueue>;
}>) {
  return (
    <AdminShell
      admin={admin}
      eyebrow="Approval Workflow"
      title="审批中心"
      description="高风险财务和配置动作必须经过多级审批，执行人和审批人保持职责分离；provider manual review 现在直接投影进统一审批队列。"
    >
      <Stack gap="16px">
        {approvals.error ? (
          <MessageBanner kind="error" message={approvals.error} />
        ) : null}
        <ApprovalSummary metrics={approvals.metrics} />
        <Grid templateColumns={{ base: "1fr", xl: "1.1fr 0.9fr" }} gap="16px">
          <ApprovalListWorkbench
            applySearch={approvals.applySearch}
            approvalTypes={approvals.approvalTypes}
            currentPage={approvals.currentPage}
            draftFilters={approvals.draftFilters}
            filteredCount={approvals.filteredItems.length}
            items={approvals.visibleItems}
            pageSize={approvals.pageSize}
            resetFilters={approvals.resetFilters}
            setCurrentPage={approvals.setCurrentPage}
            setDraftFilters={approvals.setDraftFilters}
            setPageSize={approvals.setPageSize}
            totalCount={approvals.items.length}
            totalPages={approvals.totalPages}
          />
          <ApprovalInsightsPanel hotItems={approvals.hotItems} />
        </Grid>
      </Stack>
    </AdminShell>
  );
}
