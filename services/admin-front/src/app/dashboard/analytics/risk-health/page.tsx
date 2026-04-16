"use client";

import { AnalyticsRiskHealthScreen } from "@/features/dashboard/analytics-dashboard-screen";
import { useAdminSession } from "@/lib/use-admin-session";

export default function AnalyticsRiskHealthPage() {
  const { admin, token, loading } = useAdminSession();

  if (loading || !admin || !token) {
    return null;
  }

  return <AnalyticsRiskHealthScreen admin={admin} token={token} />;
}
