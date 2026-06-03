"use client";

import { AnalyticsMoneyFlowScreen } from "@/features/dashboard/analytics-money-flow-screen";
import { useAdminSession } from "@/lib/use-admin-session";

export default function AnalyticsMoneyFlowPage() {
  const { admin, token, loading } = useAdminSession();

  if (loading || !admin || !token) {
    return null;
  }

  return <AnalyticsMoneyFlowScreen admin={admin} token={token} />;
}
