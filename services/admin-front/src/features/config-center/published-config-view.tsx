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
import type { BusinessPolicyPayload } from "@/services/admin-api";

import {
  buildPolicyDiffRows,
  buildPolicySnapshotRows,
} from "./config-center-presenters";
import { useConfigOverview } from "./use-config-overview";

function PublishedMetrics({
  diffCount,
  publishedAt,
  publishedBy,
  publishedVersion,
}: Readonly<{
  diffCount: number;
  publishedAt: string;
  publishedBy: string;
  publishedVersion: number;
}>) {
  return (
    <Grid templateColumns={{ base: "1fr", lg: "repeat(3, 1fr)" }} gap="14px">
      <MetricCard
        label="Published Version"
        value={`v${publishedVersion}`}
        meta={publishedAt}
      />
      <MetricCard
        label="Published By"
        value={publishedBy}
        meta="last publishing operator"
      />
      <MetricCard
        label="Draft Differences"
        value={diffCount}
        meta={diffCount > 0 ? "needs review" : "clean"}
      />
    </Grid>
  );
}

function DraftDiffSection({
  draftPolicy,
  publishedPolicy,
}: Readonly<{
  draftPolicy: BusinessPolicyPayload;
  publishedPolicy: BusinessPolicyPayload;
}>) {
  const diffRows = buildPolicyDiffRows(draftPolicy, publishedPolicy);
  if (diffRows.length === 0) {
    return (
      <MessageBanner
        kind="success"
        message="当前 draft 与 published 没有差异。"
      />
    );
  }
  return (
    <SurfaceCard
      eyebrow="Draft Diff"
      title="待发布差异"
      description="这些字段的 draft 与 published 不一致，发布前需要核对影响。"
    >
      <Grid templateColumns={{ base: "1fr", xl: "repeat(2, 1fr)" }} gap="12px">
        {diffRows.map((row) => (
          <Box
            key={row.label}
            borderRadius="18px"
            border="1px solid rgba(184, 92, 18, 0.16)"
            bg="rgba(255, 247, 237, 0.78)"
            p="14px"
          >
            <Text fontWeight="700" color="ink.900">
              {row.label}
            </Text>
            <Text mt="6px" color="ink.500">
              draft={row.draft} {row.unit} · published={row.published}{" "}
              {row.unit}
            </Text>
          </Box>
        ))}
      </Grid>
    </SurfaceCard>
  );
}

function PublishedSnapshotSection({
  policy,
}: Readonly<{ policy: BusinessPolicyPayload }>) {
  const snapshotRows = buildPolicySnapshotRows(policy);
  return (
    <SurfaceCard
      eyebrow="Structured Snapshot"
      title="Published Policy"
      description="默认结构化展示，便于快速扫描当前运行基线。"
    >
      <Grid templateColumns={{ base: "1fr", xl: "repeat(3, 1fr)" }} gap="12px">
        {snapshotRows.map((row) => (
          <Box
            key={`${row.group}.${row.label}`}
            borderRadius="18px"
            border="1px solid rgba(15,17,21,0.08)"
            bg="rgba(247,249,252,0.78)"
            p="14px"
          >
            <Text fontSize="12px" color="ink.500">
              {row.group}
            </Text>
            <Text mt="4px" fontWeight="700" color="ink.900">
              {row.label}
            </Text>
            <Text mt="6px" color="ink.500">
              {row.value} {row.unit}
            </Text>
          </Box>
        ))}
      </Grid>
    </SurfaceCard>
  );
}

function RawSnapshotSection({
  policy,
}: Readonly<{ policy: BusinessPolicyPayload }>) {
  return (
    <SurfaceCard
      eyebrow="Raw Snapshot"
      title="原始 JSON"
      description="仅用于排查字段级问题；默认折叠，避免总览式阅读被大段 JSON 打断。"
    >
      <Box
        as="details"
        borderRadius="18px"
        border="1px solid rgba(15,17,21,0.08)"
        bg="rgba(247,249,252,0.78)"
        p="14px"
      >
        <Box as="summary" cursor="pointer" fontWeight="700">
          查看原始快照 JSON
        </Box>
        <Box
          as="pre"
          mt="14px"
          p="14px"
          borderRadius="16px"
          bg="rgba(12,16,20,0.92)"
          color="white"
          fontSize="12px"
          overflowX="auto"
        >
          {JSON.stringify(policy, null, 2)}
        </Box>
      </Box>
    </SurfaceCard>
  );
}

export function PublishedConfigView() {
  const { admin, token, loading } = useAdminSession();
  const { bootstrapping, error, overview } = useConfigOverview(token);

  if (loading || !admin || bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="已发布快照加载中"
        message="正在读取 published policy..."
      />
    );
  }
  if (!overview) {
    return (
      <AdminShell
        admin={admin}
        eyebrow="Ops Controls"
        title="已发布快照"
        description="已发布业务参数暂时不可用。"
      >
        <MessageBanner
          kind="error"
          message={error ?? "已发布业务参数暂时不可用。"}
        />
      </AdminShell>
    );
  }

  const diffRows = buildPolicyDiffRows(
    overview.draft.policy,
    overview.published.policy
  );
  const publishedAt = overview.published.meta.publishedAt
    ? formatDateTime(overview.published.meta.publishedAt)
    : "n/a";
  return (
    <AdminShell
      admin={admin}
      eyebrow="Ops Controls"
      title="已发布快照"
      description="只读查看当前 published policy；draft 差异会突出显示，原始 JSON 默认折叠。"
    >
      <Stack gap="16px">
        {error ? <MessageBanner kind="error" message={error} /> : null}
        <PublishedMetrics
          diffCount={diffRows.length}
          publishedAt={publishedAt}
          publishedBy={overview.published.meta.publishedBy ?? "unknown"}
          publishedVersion={overview.published.meta.publishedVersion}
        />
        <DraftDiffSection
          draftPolicy={overview.draft.policy}
          publishedPolicy={overview.published.policy}
        />
        <PublishedSnapshotSection policy={overview.published.policy} />
        <RawSnapshotSection policy={overview.published.policy} />
      </Stack>
    </AdminShell>
  );
}
