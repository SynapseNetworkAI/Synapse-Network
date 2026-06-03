"use client";

import { Stack } from "@chakra-ui/react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { useAdminSession } from "@/lib/use-admin-session";
import type { AdminProfile } from "@/services/admin-api";

import { ProviderServiceRegistry } from "./provider-service-registry";
import { ProviderServiceSummary } from "./provider-service-summary";
import { useProviderServices } from "./use-provider-services";

export function ProviderServicesWorkspace() {
  const { admin, token, loading } = useAdminSession();
  const providerServices = useProviderServices(token);

  if (loading || !admin || providerServices.bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="Provider Registry Sync"
        message="正在同步 Gateway Provider 服务注册表..."
      />
    );
  }

  return (
    <ProviderServicesShell admin={admin} providerServices={providerServices} />
  );
}

function ProviderServicesShell({
  admin,
  providerServices,
}: Readonly<{
  admin: AdminProfile;
  providerServices: ReturnType<typeof useProviderServices>;
}>) {
  const canSubmitLifecycleAction =
    admin.permissions.includes("approval:submit");

  return (
    <AdminShell
      admin={admin}
      eyebrow="Provider Registry"
      title="Provider 服务管理"
      description="这里管理注册到 Gateway 的 Provider 服务。控制面状态负责上线/暂停/冻结，运行时健康负责自动摘流和恢复，二者不互相污染。"
    >
      <Stack gap="16px">
        {providerServices.error ? (
          <MessageBanner kind="error" message={providerServices.error} />
        ) : null}
        {providerServices.notice ? (
          <MessageBanner kind="success" message={providerServices.notice} />
        ) : null}
        <ProviderServiceSummary totalCount={providerServices.totalCount} />
        <ProviderServiceRegistry
          canSubmitLifecycleAction={canSubmitLifecycleAction}
          providerServices={providerServices}
        />
      </Stack>
    </AdminShell>
  );
}
