"use client";

import { Box, Grid, Stack, Text } from "@chakra-ui/react";

import {
  MetricCard,
  SentinelStatusChip,
  SurfaceCard,
} from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import type { AdminMenuConfigMeta } from "@/services/admin-api";

import type {
  buildMenuGateCards,
  buildMenuMetrics,
  buildMenuVersionCards,
} from "./menu-presenters";

type MenuMetrics = ReturnType<typeof buildMenuMetrics>;
type MenuVersionCard = ReturnType<typeof buildMenuVersionCards>[number];
type MenuGateCard = ReturnType<typeof buildMenuGateCards>[number];

export function MenuMetricGrid({
  metrics,
}: Readonly<{ metrics: MenuMetrics }>) {
  return (
    <Grid
      templateColumns={{
        base: "1fr",
        md: "repeat(2, 1fr)",
        xl: "repeat(4, 1fr)",
      }}
      gap="16px"
    >
      <MetricCard
        label="Draft routes"
        value={metrics.totalItems}
        meta={`${metrics.sectionCount} sections`}
      />
      <MetricCard
        label="Role-gated items"
        value={metrics.gatedByRoleCount}
        meta={`${metrics.gatedByPermissionCount} permission-gated`}
      />
      <MetricCard
        label="Dual-gated items"
        value={metrics.multiGatedCount}
        meta="roles + permissions both required"
        accent="linear-gradient(180deg, rgba(255,251,244,0.98) 0%, rgba(255,242,226,0.96) 100%)"
      />
      <MetricCard
        label="Publish state"
        value={metrics.isDirty ? "DIRTY" : "SYNCED"}
        meta={
          metrics.isDirty
            ? "draft ahead of published"
            : "draft matches published"
        }
      />
    </Grid>
  );
}

export function MenuVersionSignals({
  cards,
  meta,
}: Readonly<{
  cards: MenuVersionCard[];
  meta: AdminMenuConfigMeta | null;
}>) {
  return (
    <SurfaceCard
      eyebrow="Version Signals"
      title="草稿与发布状态"
      description="导航治理的关键不是编辑动作本身，而是编辑版本和生效版本必须被明确区分。"
    >
      <Stack gap="12px">
        {cards.map((card) => (
          <Box
            key={card.key}
            borderRadius="22px"
            p="16px"
            bg="rgba(255,255,255,0.74)"
            border="1px solid rgba(99,92,82,0.10)"
          >
            <Stack direction="row" justify="space-between" align="center">
              <Text fontWeight="700">{card.label}</Text>
              <SentinelStatusChip label={card.value} tone={card.tone} />
            </Stack>
            <Text mt="8px" color="ink.500">
              {card.description}
            </Text>
          </Box>
        ))}
        <TopologyGuardrail meta={meta} />
      </Stack>
    </SurfaceCard>
  );
}

function TopologyGuardrail({
  meta,
}: Readonly<{ meta: AdminMenuConfigMeta | null }>) {
  return (
    <Box
      borderRadius="22px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Text
        fontSize="11px"
        letterSpacing="0.18em"
        textTransform="uppercase"
        color="ink.500"
      >
        Topology Guardrail
      </Text>
      <Text mt="8px" color="ink.500">
        `draft` 负责持续编辑，`published` 负责全站生效。只有显式 publish
        才能切换管理员看到的真实导航树。
      </Text>
      <Text mt="8px" color="ink.500">
        updated {formatDateTime(meta?.updatedAt ?? null)} · published{" "}
        {formatDateTime(meta?.publishedAt ?? null)}
      </Text>
    </Box>
  );
}

export function MenuGateAndDiscipline({
  cards,
}: Readonly<{ cards: MenuGateCard[] }>) {
  return (
    <Grid templateColumns={{ base: "1fr", xl: "0.96fr 1.04fr" }} gap="16px">
      <MenuGateSurface cards={cards} />
      <MenuPublishDiscipline />
    </Grid>
  );
}

function MenuGateSurface({ cards }: Readonly<{ cards: MenuGateCard[] }>) {
  return (
    <SurfaceCard
      eyebrow="Section Gates"
      title="分组级门禁"
      description="按 section 看角色门禁和权限门禁密度，能更快发现哪一层导航过宽或过窄。"
    >
      <Stack gap="12px">
        {cards.map((card) => (
          <Box
            key={card.key}
            borderRadius="22px"
            p="16px"
            bg="rgba(255,255,255,0.74)"
            border="1px solid rgba(99,92,82,0.10)"
          >
            <Stack direction="row" justify="space-between" align="center">
              <Text fontWeight="700">{card.label}</Text>
              <SentinelStatusChip
                label={`${card.totalCount} items`}
                tone={card.permissionGateCount > 0 ? "orange" : "gray"}
              />
            </Stack>
            <Text mt="8px" color="ink.500">
              role gates {card.roleGateCount} · permission gates{" "}
              {card.permissionGateCount}
            </Text>
          </Box>
        ))}
      </Stack>
    </SurfaceCard>
  );
}

function MenuPublishDiscipline() {
  const notes = [
    [
      "草稿治理",
      "Toolbar + Table + Modal 只面向 draft 工作，保证改动先收敛到待发布版本。",
    ],
    [
      "全站生效",
      "published 是 AdminShell 和普通管理员真正读取的导航树，发布动作必须有高风险确认。",
    ],
    [
      "可追溯",
      "create / update / delete / publish 都应该落管理员审计事件，配置中心不是浏览器本地状态。",
    ],
  ];

  return (
    <SurfaceCard
      eyebrow="Publish Discipline"
      title="发布纪律"
      description="菜单切换会影响所有管理员的入口，不应该在未确认草稿质量时直接全站生效。"
    >
      <Stack gap="12px">
        {notes.map(([title, description]) => (
          <Box
            key={title}
            borderRadius="22px"
            p="16px"
            bg="rgba(255,255,255,0.74)"
            border="1px solid rgba(99,92,82,0.10)"
          >
            <Text fontWeight="700">{title}</Text>
            <Text mt="8px" color="ink.500">
              {description}
            </Text>
          </Box>
        ))}
      </Stack>
    </SurfaceCard>
  );
}
