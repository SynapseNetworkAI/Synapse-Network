"use client";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { FinanceWorkspace } from "@/features/finance/finance-workspace";
import { useFinancePageData } from "@/features/finance/use-finance-page-data";
import { useAdminSession } from "@/lib/use-admin-session";

export function FinanceScreen() {
  const { admin, security, token, loading } = useAdminSession();
  const {
    approvals,
    bootstrapping,
    error,
    overview,
    reconciliationDetail,
    trendPoints,
  } = useFinancePageData(token);

  if (loading || !admin || bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="资金页面加载中"
        message="正在整理资金相关数据..."
      />
    );
  }

  if (!overview) {
    return (
      <AdminShell
        admin={admin}
        eyebrow="资金管理"
        title="资金概览"
        description="把平台当前的资金情况放在同一页，方便先判断整体是否正常，再决定是否进入明细排查。"
      >
        <MessageBanner
          kind="error"
          message={error ?? "资金运营视图暂时不可用。"}
        />
      </AdminShell>
    );
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="资金管理"
      title="资金概览"
      description="把平台当前的资金情况放在同一页，方便业务先看余额、收支和待处理事项，再决定是否进入明细排查。"
    >
      <FinanceWorkspace
        admin={admin}
        approvals={approvals}
        error={error}
        overview={overview}
        reconciliationDetail={reconciliationDetail}
        security={security}
        token={token}
        trendPoints={trendPoints}
      />
    </AdminShell>
  );
}
