"use client";

import { useAdminSession } from "@/lib/use-admin-session";
import { DashboardOverviewScreen } from "@/features/dashboard/dashboard-overview-screen";

export default function DashboardOverviewPage() {
  const { admin, token, loading } = useAdminSession();

  if (loading) {
    return null;
  }

  if (!admin || !token) {
    return null;
  }

  return <DashboardOverviewScreen admin={admin} token={token} />;
}