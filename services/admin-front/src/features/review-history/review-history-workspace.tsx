"use client";

import { Button } from "@chakra-ui/react";
import Link from "next/link";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { useAdminSession } from "@/lib/use-admin-session";
import type { AdminProfile } from "@/services/admin-api";

import { ReviewHistoryDetailPanel } from "./review-history-detail-panel";
import { ReviewHistoryInsights } from "./review-history-insights";
import { ReviewHistoryLedger } from "./review-history-list";
import { ReviewHistoryMetricGrid } from "./review-history-summary";
import { useReviewHistory } from "./use-review-history";

export function ReviewHistoryWorkspace() {
  const { admin, token, loading } = useAdminSession();
  const history = useReviewHistory(token);

  if (loading || !admin) {
    return (
      <ControlPlaneLoadingScreen
        title="Review History Replay"
        message="正在回放审核历史..."
      />
    );
  }

  return <ReviewHistoryShell admin={admin} history={history} />;
}

function ReviewHistoryShell({
  admin,
  history,
}: Readonly<{
  admin: AdminProfile;
  history: ReturnType<typeof useReviewHistory>;
}>) {
  return (
    <AdminShell
      admin={admin}
      eyebrow="业务回溯"
      title="审核历史"
      description="回看提现审核已经做出的处理结论，并确认这些单子当前是已放行、已完成、已拒绝，还是已经释放回余额。"
      actions={
        <Link href="/withdrawal-reviews">
          <Button size="sm" borderRadius="full">
            返回提现审核
          </Button>
        </Link>
      }
    >
      {history.error ? (
        <MessageBanner kind="error" message={history.error} />
      ) : null}
      <ReviewHistoryMetricGrid metrics={history.metrics} />
      <ReviewHistoryLedger history={history} />
      <ReviewHistoryInsights />
      <ReviewHistoryDetailPanel history={history} />
    </AdminShell>
  );
}
