"use client";

import { AnalyticsDataQualityScreen } from "@/features/dashboard/analytics-dashboard-screen";
import { useAdminSession } from "@/lib/use-admin-session";

export default function AnalyticsDataQualityPage() {
  const { admin, token, loading } = useAdminSession();

  if (loading || !admin || !token) {
    return null;
  }

  return <AnalyticsDataQualityScreen admin={admin} token={token} />;
}
