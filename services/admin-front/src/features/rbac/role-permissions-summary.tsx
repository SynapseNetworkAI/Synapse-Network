"use client";

import { Box, Grid, Heading, Stack, Text } from "@chakra-ui/react";

import {
  MetricCard,
  SentinelStatusChip,
  SurfaceCard,
} from "@/components/console-ui";
import type { AdminPermissionCatalogItem } from "@/services/admin-api";

import type {
  buildPermissionGroups,
  buildRoleDomainCards,
  buildRoleMetrics,
  buildRoleRiskCards,
} from "./role-presenters";

type RoleMetrics = ReturnType<typeof buildRoleMetrics>;
type RoleRiskCard = ReturnType<typeof buildRoleRiskCards>[number];
type RoleDomainCard = ReturnType<typeof buildRoleDomainCards>[number];
type PermissionGroup = ReturnType<typeof buildPermissionGroups>[number];

export function RoleMetricGrid({
  metrics,
  permissionCount,
  canManage,
}: Readonly<{
  metrics: RoleMetrics;
  permissionCount: number;
  canManage: boolean;
}>) {
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
        label="Role catalog"
        value={metrics.totalRoles}
        meta={`${metrics.activeCount} active / ${metrics.disabledCount} disabled`}
      />
      <MetricCard
        label="Permission coverage"
        value={`${metrics.coveredPermissionCount}/${permissionCount}`}
        meta={`${metrics.uncoveredPermissionCount} still uncovered`}
      />
      <MetricCard
        label="Max privilege span"
        value={metrics.maxPermissionCount}
        meta="widest single-role permission surface"
        accent="linear-gradient(180deg, rgba(255,251,244,0.98) 0%, rgba(255,242,226,0.96) 100%)"
      />
      <MetricCard
        label="Governance mode"
        value={canManage ? "WRITE" : "READ"}
        meta={
          canManage ? "super_admin can grant/revoke" : "session is read-only"
        }
      />
    </Grid>
  );
}

export function RoleRiskSurface({
  cards,
}: Readonly<{ cards: RoleRiskCard[] }>) {
  return (
    <Box id="reviewer-split" scrollMarginTop="28px">
      <SurfaceCard
        eyebrow="Reviewer Split"
        title="Reviewer 分工"
        description="角色治理的核心不是建表，而是快速识别谁拥有过宽权限面，谁具备提权能力。"
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
                <Stack gap="4px">
                  <Heading size="sm">{card.label}</Heading>
                  <Text color="ink.500">{card.roleKey}</Text>
                </Stack>
                <SentinelStatusChip
                  label={`${card.permissionCount} perms`}
                  tone={card.tone}
                />
              </Stack>
              <Text mt="8px" color="ink.500">
                {card.description}
              </Text>
            </Box>
          ))}
          <RbacGuardrail />
        </Stack>
      </SurfaceCard>
    </Box>
  );
}

function RbacGuardrail() {
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
        RBAC Guardrail
      </Text>
      <Text mt="8px" color="ink.500">
        前端不能只做菜单隐藏。角色页要明确区分可读、可发起、可审批和可执行的边界，尤其是
        `admin_role:grant` 这类高风险能力。
      </Text>
    </Box>
  );
}

export function RoleModuleBoundaries({
  permissionGroups,
  domainCards,
  permissionCount,
}: Readonly<{
  permissionGroups: PermissionGroup[];
  domainCards: RoleDomainCard[];
  permissionCount: number;
}>) {
  return (
    <Box id="module-boundaries" scrollMarginTop="28px">
      <Grid templateColumns={{ base: "1fr", xl: "1.04fr 0.96fr" }} gap="16px">
        <PermissionCatalogSurface
          groups={permissionGroups}
          permissionCount={permissionCount}
        />
        <RoleDomainCoverageSurface cards={domainCards} />
      </Grid>
    </Box>
  );
}

function PermissionCatalogSurface({
  groups,
  permissionCount,
}: Readonly<{ groups: PermissionGroup[]; permissionCount: number }>) {
  return (
    <SurfaceCard
      eyebrow="Module Boundaries"
      title="模块边界"
      description="按 resource domain 展示完整 permission catalog，便于角色建模时快速核对。"
      stamp={`${permissionCount} permissions`}
    >
      <Grid templateColumns={{ base: "1fr", lg: "repeat(3, 1fr)" }} gap="12px">
        {groups.map((group) => (
          <PermissionDomainCard key={group.domain} group={group} />
        ))}
      </Grid>
    </SurfaceCard>
  );
}

function PermissionDomainCard({ group }: Readonly<{ group: PermissionGroup }>) {
  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Heading size="sm">{group.domain}</Heading>
      <Stack gap="8px" mt="10px">
        {group.items.map((permission: AdminPermissionCatalogItem) => (
          <Box
            key={permission.permissionKey}
            borderRadius="14px"
            p="10px"
            bg="rgba(247,241,233,0.80)"
          >
            <Text fontWeight="700">{permission.permissionKey}</Text>
            <Text color="ink.500">
              {permission.action} · {permission.riskLevel}
            </Text>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function RoleDomainCoverageSurface({
  cards,
}: Readonly<{ cards: RoleDomainCard[] }>) {
  return (
    <SurfaceCard
      eyebrow="Domain Coverage"
      title="资源域覆盖率"
      description="先看哪些权限域已经被活动角色覆盖，哪些仍然裸露，才能判断当前 RBAC 是否成体系。"
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
              <Heading size="sm">{card.label}</Heading>
              <SentinelStatusChip
                label={`${card.coveredCount}/${card.permissionCount}`}
                tone={
                  card.coveredCount === card.permissionCount
                    ? "green"
                    : "orange"
                }
              />
            </Stack>
            <Text mt="8px" color="ink.500">
              active roles {card.activeRoleCount}
            </Text>
          </Box>
        ))}
      </Stack>
    </SurfaceCard>
  );
}
