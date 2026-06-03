"use client";

import { DashboardRuntimeScreen } from "@/features/dashboard/dashboard-runtime-screen";
import { useAdminSession } from "@/lib/use-admin-session";

export default function DashboardRuntimePage() {
  const { admin, token, loading } = useAdminSession();

  if (loading || !admin || !token) {
    return null;
  }

  return <DashboardRuntimeScreen admin={admin} token={token} />;
}
