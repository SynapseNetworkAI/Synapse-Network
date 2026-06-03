"use client";

import { Box, Grid, Stack, Text } from "@chakra-ui/react";

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
  buildRuntimeSource,
  flattenRuntimeSummary,
  groupRuntimeRowsBySource,
  type RuntimeSummaryRow,
} from "./config-center-presenters";
import { useConfigOverview } from "./use-config-overview";

function RuntimeMetrics({
  publishedVersion,
  runtimeSource,
  updatedAt,
  updatedBy,
}: Readonly<{
  publishedVersion: number | string;
  runtimeSource: string;
  updatedAt: string;
  updatedBy: string;
}>) {
  return (
    <Grid templateColumns={{ base: "1fr", lg: "repeat(3, 1fr)" }} gap="14px">
      <MetricCard
        label="Runtime Source"
        value={runtimeSource}
        meta="Gateway active business policy source"
      />
      <MetricCard
        label="Published Version"
        value={`v${publishedVersion}`}
        meta="runtime-reported version"
      />
      <MetricCard label="Runtime Updated" value={updatedAt} meta={updatedBy} />
    </Grid>
  );
}

function RuntimeRowCard({ row }: Readonly<{ row: RuntimeSummaryRow }>) {
  return (
    <Box
      borderRadius="18px"
      border="1px solid rgba(15,17,21,0.08)"
      bg="rgba(247,249,252,0.78)"
      p="14px"
    >
      <Text fontSize="12px" color="ink.500">
        {row.section}
      </Text>
      <Text mt="4px" fontWeight="700" color="ink.900">
        {row.key}
      </Text>
      <Text mt="6px" color="ink.500">
        value={row.displayValue}
        {row.configured !== null
          ? ` · configured=${String(row.configured)}`
          : ""}
        {row.sensitive ? " · sensitive redacted" : ""}
      </Text>
    </Box>
  );
}

function RuntimeGroups({ rows }: Readonly<{ rows: RuntimeSummaryRow[] }>) {
  const groups = groupRuntimeRowsBySource(rows);
  return (
    <SurfaceCard
      eyebrow="Runtime / Infra Summary"
      title="来源分组"
      description="按 source 分组展示只读配置状态；敏感配置不会显示真实值。"
    >
      <Stack gap="14px">
        {groups.map((group) => (
          <Box
            key={group.source}
            borderRadius="22px"
            border="1px solid rgba(15,17,21,0.08)"
            bg="rgba(255,255,255,0.72)"
            p="18px"
          >
            <Text
              fontSize="11px"
              letterSpacing="0.18em"
              textTransform="uppercase"
              color="signal.700"
            >
              source: {group.source}
            </Text>
            <Grid
              templateColumns={{ base: "1fr", xl: "repeat(2, 1fr)" }}
              gap="12px"
              mt="14px"
            >
              {group.rows.map((row) => (
                <RuntimeRowCard key={`${row.section}.${row.key}`} row={row} />
              ))}
            </Grid>
          </Box>
        ))}
      </Stack>
    </SurfaceCard>
  );
}

function RuntimeErrorBanner({
  error,
}: Readonly<{
  error: BusinessPolicyOverviewResponse["runtime"]["error"];
}>) {
  if (!error) return null;
  return (
    <MessageBanner kind="error" message={`${error.code}: ${error.message}`} />
  );
}

function buildRuntimeViewModel(overview: BusinessPolicyOverviewResponse) {
  const runtimePolicy = overview.runtime.businessPolicy;
  return {
    publishedVersion: runtimePolicy?.publishedVersion ?? "n/a",
    rows: flattenRuntimeSummary(overview.runtime.envSummary),
    runtimeError: overview.runtime.error,
    runtimeSource: buildRuntimeSource(overview),
    updatedAt: runtimePolicy?.updatedAt
      ? formatDateTime(runtimePolicy.updatedAt)
      : "n/a",
    updatedBy: runtimePolicy?.updatedBy ?? "unknown",
  };
}

export function RuntimeConfigView() {
  const { admin, token, loading } = useAdminSession();
  const { bootstrapping, error, overview } = useConfigOverview(token);

  if (loading || !admin || bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="运行时来源加载中"
        message="正在读取 Gateway runtime 与 env 来源摘要..."
      />
    );
  }
  if (!overview) {
    return (
      <AdminShell
        admin={admin}
        eyebrow="Ops Controls"
        title="运行时来源"
        description="运行时来源暂时不可用。"
      >
        <MessageBanner
          kind="error"
          message={error ?? "运行时来源暂时不可用。"}
        />
      </AdminShell>
    );
  }

  const viewModel = buildRuntimeViewModel(overview);
  return (
    <AdminShell
      admin={admin}
      eyebrow="Ops Controls"
      title="运行时来源"
      description="只读检查 Gateway 当前实际读取的配置来源；secret、DSN、KMS、私钥等敏感项只显示 configured 状态。"
    >
      <Stack gap="16px">
        {error ? <MessageBanner kind="error" message={error} /> : null}
        <RuntimeMetrics
          publishedVersion={viewModel.publishedVersion}
          runtimeSource={viewModel.runtimeSource}
          updatedAt={viewModel.updatedAt}
          updatedBy={viewModel.updatedBy}
        />
        <RuntimeErrorBanner error={viewModel.runtimeError} />
        <RuntimeGroups rows={viewModel.rows} />
      </Stack>
    </AdminShell>
  );
}
