"use client";

import { AnalyticsInvocationRevenueScreen } from "@/features/dashboard/analytics-invocation-revenue-screen";
import { useAdminSession } from "@/lib/use-admin-session";

export default function AnalyticsInvocationRevenuePage() {
  const { admin, token, loading } = useAdminSession();

  if (loading || !admin || !token) {
    return null;
  }

  return <AnalyticsInvocationRevenueScreen admin={admin} token={token} />;
}
