"use client";

import { useEffect } from "react";

import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { getCurrentAdmin } from "@/services/admin-api";

type SessionRouteRouter = {
  replace: (href: string) => void;
};

function routeIfActive({
  cancelled,
  router,
  target,
}: Readonly<{
  cancelled: boolean;
  router: SessionRouteRouter;
  target: string;
}>) {
  if (cancelled) {
    return;
  }
  router.replace(target);
}

async function bootstrapSessionRoute(
  router: SessionRouteRouter,
  isCancelled: () => boolean
) {
  try {
    await getCurrentAdmin("cookie-session");
    routeIfActive({ cancelled: isCancelled(), router, target: "/dashboard" });
  } catch {
    routeIfActive({ cancelled: isCancelled(), router, target: "/login" });
  }
}

export function SessionRouteBootstrapScreen({
  router,
}: Readonly<{ router: SessionRouteRouter }>) {
  useEffect(() => {
    let cancelled = false;
    void bootstrapSessionRoute(router, () => cancelled);

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <ControlPlaneLoadingScreen
      title="Session Route Bootstrap"
      message="正在检查管理员会话并路由到登录页或后台首页..."
    />
  );
}
