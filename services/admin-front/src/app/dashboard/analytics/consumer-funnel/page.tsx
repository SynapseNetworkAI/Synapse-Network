"use client";

import { AnalyticsConsumerFunnelScreen } from "@/features/dashboard/analytics-consumer-funnel-screen";
import { useAdminSession } from "@/lib/use-admin-session";

export default function AnalyticsConsumerFunnelPage() {
  const { admin, token, loading } = useAdminSession();

  if (loading || !admin || !token) {
    return null;
  }

  return <AnalyticsConsumerFunnelScreen admin={admin} token={token} />;
}
