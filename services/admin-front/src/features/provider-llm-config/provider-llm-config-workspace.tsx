"use client";

import { Stack } from "@chakra-ui/react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { useAdminSession } from "@/lib/use-admin-session";
import type { AdminProfile } from "@/services/admin-api";
import type { ProviderLlmConfigSnapshot } from "@/services/provider-llm-config-api";

import {
  ProviderLlmModelCatalogTable,
  ProviderLlmRolloutMetrics,
  ProviderLlmVendorTable,
} from "./provider-llm-config-sections";
import { useProviderLlmConfig } from "./use-provider-llm-config";

export function ProviderLlmConfigWorkspace() {
  const { admin, token, loading } = useAdminSession();
  const providerLlm = useProviderLlmConfig(token);

  if (loading || providerLlm.bootstrapping || !admin) {
    return (
      <ControlPlaneLoadingScreen
        title="Provider LLM Config"
        message="正在同步上游模型目录和生产上线闸门..."
      />
    );
  }

  return (
    <ProviderLlmConfigShell
      admin={admin}
      busyServiceId={providerLlm.busyServiceId}
      error={providerLlm.error}
      notice={providerLlm.notice}
      snapshot={providerLlm.snapshot}
      onRequestRollout={providerLlm.requestRollout}
    />
  );
}

function ProviderLlmConfigShell({
  admin,
  busyServiceId,
  error,
  notice,
  onRequestRollout,
  snapshot,
}: Readonly<{
  admin: AdminProfile;
  busyServiceId: string | null;
  error: string | null;
  notice: string | null;
  snapshot: ProviderLlmConfigSnapshot | null;
  onRequestRollout: ReturnType<typeof useProviderLlmConfig>["requestRollout"];
}>) {
  const models = snapshot?.models ?? [];
  const rollouts = snapshot?.rolloutStates ?? [];

  return (
    <AdminShell
      admin={admin}
      eyebrow="Provider LLM Control"
      title="LLM 配置治理"
      description="管理 OpenAI-compatible 上游供应商、模型目录、价格复核和环境 rollout request。API key 只显示 secret reference，不进入注册表明文配置。"
    >
      <Stack gap="16px">
        {error ? <MessageBanner kind="error" message={error} /> : null}
        {notice ? <MessageBanner kind="success" message={notice} /> : null}
        <ProviderLlmRolloutMetrics snapshot={snapshot} />
        <ProviderLlmVendorTable vendors={snapshot?.vendors ?? []} />
        <ProviderLlmModelCatalogTable
          models={models}
          rollouts={rollouts}
          busyServiceId={busyServiceId}
          onRequestRollout={onRequestRollout}
        />
      </Stack>
    </AdminShell>
  );
}
