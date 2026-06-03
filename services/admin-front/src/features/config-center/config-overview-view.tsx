"use client";

import { Grid, Stack, Text } from "@chakra-ui/react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import {
  MessageBanner,
  MetricCard,
  SurfaceCard,
} from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import { useAdminSession } from "@/lib/use-admin-session";
import type { BusinessPolicyOverviewResponse } from "@/services/admin-api";

import {
  buildConfigEntryCards,
  buildMetaStamp,
  buildPolicyDiffRows,
  buildRuntimeSource,
} from "./config-center-presenters";
import { useConfigOverview } from "./use-config-overview";

function ConfigStatusGrid({
  draftMeta,
  isDirty,
  publishedAt,
  publishedBy,
  runtimeMeta,
  runtimeSource,
}: Readonly<{
  draftMeta: string;
  isDirty: boolean;
  publishedAt: string;
  publishedBy: string;
  runtimeMeta: string;
  runtimeSource: string;
}>) {
  return (
    <Grid templateColumns={{ base: "1fr", lg: "repeat(3, 1fr)" }} gap="16px">
      <MetricCard
        label="Draft / Published"
        value={isDirty ? "Dirty" : "Clean"}
        meta={draftMeta}
      />
      <MetricCard
        label="Runtime Source"
        value={runtimeSource}
        meta={runtimeMeta}
      />
      <MetricCard
        label="Last Published"
        value={publishedAt}
        meta={publishedBy}
      />
    </Grid>
  );
}

function ConfigEntryGrid() {
  return (
    <SurfaceCard
      eyebrow="Configuration Modules"
      title="配置模块入口"
      description="选择一个专项页面继续操作，避免在总览页处理高风险配置。"
    >
      <Grid templateColumns={{ base: "1fr", xl: "repeat(4, 1fr)" }} gap="14px">
        {buildConfigEntryCards().map((entry) => (
          <MetricCard
            key={entry.key}
            label={entry.title}
            value="Open"
            meta={<Text>{entry.description}</Text>}
            href={entry.href}
            actionLabel={entry.actionLabel}
          />
        ))}
      </Grid>
    </SurfaceCard>
  );
}

function buildOverviewViewModel(overview: BusinessPolicyOverviewResponse) {
  const diffRows = buildPolicyDiffRows(
    overview.draft.policy,
    overview.published.policy
  );
  return {
    diffCount: diffRows.length,
    draftMeta: buildMetaStamp(overview.draft),
    isDirty: overview.draft.meta.isDirty,
    publishedAt: overview.published.meta.publishedAt
      ? formatDateTime(overview.published.meta.publishedAt)
      : "n/a",
    publishedBy: overview.published.meta.publishedBy ?? "unknown operator",
    riskKind: diffRows.length > 0 ? "error" : "success",
    riskMessage:
      diffRows.length > 0
        ? `当前 draft 与 published 有 ${diffRows.length} 项差异，发布前请进入业务策略配置核对。`
        : "当前 draft 与 published 保持一致，没有待发布差异。",
    runtimeMeta: overview.runtime.businessPolicy?.updatedAt
      ? `updated ${formatDateTime(overview.runtime.businessPolicy.updatedAt)}`
      : "runtime snapshot not stamped",
    runtimeSource: buildRuntimeSource(overview),
  } as const;
}

export function ConfigOverviewView() {
  const { admin, token, loading } = useAdminSession();
  const { bootstrapping, error, overview } = useConfigOverview(token);

  if (loading || !admin || bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="配置中心同步中"
        message="正在读取 draft、published 与运行时来源..."
      />
    );
  }
  if (!overview) {
    return (
      <AdminShell
        admin={admin}
        eyebrow="Ops Controls"
        title="配置中心"
        description="业务参数配置中心暂时不可用。"
      >
        <MessageBanner
          kind="error"
          message={error ?? "配置中心运行视图暂时不可用。"}
        />
      </AdminShell>
    );
  }

  const viewModel = buildOverviewViewModel(overview);

  return (
    <AdminShell
      admin={admin}
      eyebrow="Ops Controls"
      title="配置中心"
      description="这里只保留配置健康状态和分流入口；编辑、运行时排查和 published 快照分别进入专项页面。"
    >
      <Stack gap="16px">
        {error ? <MessageBanner kind="error" message={error} /> : null}
        <MessageBanner
          kind={viewModel.riskKind}
          message={viewModel.riskMessage}
        />
        <ConfigStatusGrid
          draftMeta={viewModel.draftMeta}
          isDirty={viewModel.isDirty}
          publishedAt={viewModel.publishedAt}
          publishedBy={viewModel.publishedBy}
          runtimeMeta={viewModel.runtimeMeta}
          runtimeSource={viewModel.runtimeSource}
        />
        <ConfigEntryGrid />
      </Stack>
    </AdminShell>
  );
}
