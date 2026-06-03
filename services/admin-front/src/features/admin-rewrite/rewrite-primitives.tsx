"use client";

import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  DataTable,
  EmptyBlock,
  MetricCard,
  SurfaceCard,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";

import type {
  AdminRewriteRouteMode,
  AdminRewriteRouteSpec,
} from "./module-catalog";

type RewriteWorkspaceProps = {
  spec: AdminRewriteRouteSpec;
  metrics: Array<{ label: string; value: string | number; meta: string }>;
  children?: ReactNode;
};

const modeLabels: Record<AdminRewriteRouteMode, string> = {
  action: "Action",
  crud: "CRUD",
  investigation: "Investigation",
  list: "List",
  overview: "Overview",
  readonly: "Read-only",
};

function nextHrefFor(spec: AdminRewriteRouteSpec): string | null {
  if (spec.route === "/dashboard/overview") return "/system";
  if (spec.route === "/finance") return "/finance/reconciliation";
  if (spec.route === "/approvals") return "/withdrawal-reviews";
  if (spec.route === "/config") return "/config/business-policy";
  if (spec.route === "/forum-support") return "/forum-support";
  return null;
}

export function RewriteStatusStrip({
  metrics,
}: Readonly<{ metrics: RewriteWorkspaceProps["metrics"] }>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap="14px">
      {metrics.map((metric) => (
        <MetricCard
          key={metric.label}
          label={metric.label}
          value={metric.value}
          meta={metric.meta}
        />
      ))}
    </Grid>
  );
}

export function RewriteModuleWorkspace({
  children,
  metrics,
  spec,
}: Readonly<RewriteWorkspaceProps>) {
  const nextHref = nextHrefFor(spec);
  return (
    <Stack gap="16px" data-testid={`rewrite-module-${spec.module}`}>
      <SurfaceCard
        eyebrow={spec.eyebrow}
        title={spec.title}
        description={spec.description}
        stamp={modeLabels[spec.mode]}
        actions={
          nextHref && spec.primaryAction ? (
            <Link href={nextHref}>
              <Button
                size="sm"
                borderRadius="lg"
                bg="shadcn.primary"
                color="shadcn.primaryForeground"
              >
                {spec.primaryAction}
              </Button>
            </Link>
          ) : null
        }
      >
        <RewriteStatusStrip metrics={metrics} />
      </SurfaceCard>
      {children ?? <RewriteSectionMap spec={spec} />}
    </Stack>
  );
}

export function RewriteSectionMap({
  spec,
}: Readonly<{ spec: AdminRewriteRouteSpec }>) {
  return (
    <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
      <SurfaceCard
        eyebrow="Module Sections"
        title="功能拆分"
        description="每个分区都应该成为独立列表、CRUD、只读详情或动作模块，而不是把所有控件平铺在首屏。"
      >
        <Stack gap="12px">
          {spec.sections.map((section, index) => (
            <Box
              key={section}
              borderRadius="lg"
              bg="shadcn.background"
              border="1px solid"
              borderColor="shadcn.border"
              p="14px"
            >
              <Text fontSize="12px" color="shadcn.mutedForeground">
                {String(index + 1).padStart(2, "0")}
              </Text>
              <Heading mt="4px" size="sm">
                {section}
              </Heading>
            </Box>
          ))}
        </Stack>
      </SurfaceCard>
      <RewriteListPreview spec={spec} />
    </Grid>
  );
}

function RewriteListPreview({
  spec,
}: Readonly<{ spec: AdminRewriteRouteSpec }>) {
  if (spec.mode === "overview") {
    return (
      <SurfaceCard
        eyebrow="Entry Design"
        title="模块入口"
        description="入口页只展示状态和下一跳，不直接承载长表单。"
      >
        <EmptyBlock
          title="等待专项页选择"
          description="从左侧菜单或模块入口进入具体列表、配置、审批或调查页。"
        />
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard
      eyebrow="List Contract"
      title="列表工作区"
      description="所有列表页统一为筛选、表格、分页三段式，行级动作进入弹窗。"
    >
      <DataTable>
        <TableHeaderRow>
          <Th>Surface</Th>
          <Th>Mode</Th>
          <Th>Action model</Th>
        </TableHeaderRow>
        <TableBody>
          <Box as="tr">
            <Td>{spec.title}</Td>
            <Td>{modeLabels[spec.mode]}</Td>
            <Td>{spec.primaryAction ?? "read-only"}</Td>
          </Box>
        </TableBody>
      </DataTable>
    </SurfaceCard>
  );
}
