"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { getCurrentAdmin } from "@/services/admin-api";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function routeSession() {
      try {
        await getCurrentAdmin("cookie-session");
        if (!cancelled) {
          router.replace("/dashboard");
        }
      } catch {
        if (!cancelled) {
          router.replace("/login");
        }
      }
    }

    void routeSession();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return <ControlPlaneLoadingScreen title="Session Route Bootstrap" message="正在检查管理员会话并路由到登录页或后台首页..." />;
}
