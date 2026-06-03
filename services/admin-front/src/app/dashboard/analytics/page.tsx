"use client";

import { AnalyticsOverviewScreen } from "@/features/dashboard/analytics-overview-screen";
import { useAdminSession } from "@/lib/use-admin-session";

export default function DashboardAnalyticsPage() {
  const { admin, token, loading } = useAdminSession();

  if (loading || !admin || !token) {
    return null;
  }

  return <AnalyticsOverviewScreen admin={admin} token={token} />;
}
