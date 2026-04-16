"use client";

import { AnalyticsProviderRevenueScreen } from "@/features/dashboard/analytics-dashboard-screen";
import { useAdminSession } from "@/lib/use-admin-session";

export default function AnalyticsProviderRevenuePage() {
  const { admin, token, loading } = useAdminSession();

  if (loading || !admin || !token) {
    return null;
  }

  return <AnalyticsProviderRevenueScreen admin={admin} token={token} />;
}
