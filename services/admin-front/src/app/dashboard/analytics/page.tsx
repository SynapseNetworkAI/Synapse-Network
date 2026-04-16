"use client";

import { AnalyticsDashboardScreen } from "@/features/dashboard/analytics-dashboard-screen";
import { useAdminSession } from "@/lib/use-admin-session";

export default function DashboardAnalyticsPage() {
  const { admin, token, loading } = useAdminSession();

  if (loading || !admin || !token) {
    return null;
  }

  return <AnalyticsDashboardScreen admin={admin} token={token} />;
}
