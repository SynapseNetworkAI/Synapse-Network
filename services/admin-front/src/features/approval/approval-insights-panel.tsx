"use client";

import { Box, Button, Heading, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";

import { SentinelStatusChip, SurfaceCard } from "@/components/console-ui";
import { formatUsdc } from "@/lib/admin-console";
import type { ApprovalItem } from "@/services/admin-api";

import {
  getApprovalLevelTone,
  getApprovalStatusLabel,
  getApprovalStatusTone,
  getApprovalTypeLabel,
} from "./approval-presenters";

export function ApprovalInsightsPanel({
  hotItems,
}: Readonly<{ hotItems: ApprovalItem[] }>) {
  return (
    <Stack gap="16px">
      <SurfaceCard
        eyebrow="Hot Queue"
        title="优先处理项"
        description="按风险等级、审核状态和类型做优先级排序，先把最值得 reviewer 打开的单子顶出来。"
        actions={
          <Link href="/withdrawal-reviews">
            <Button size="sm" borderRadius="full">
              提现专用工作台
            </Button>
          </Link>
        }
      >
        <Stack gap="12px">
          {hotItems.map((item) => (
            <ApprovalHotItemCard item={item} key={item.approvalId} />
          ))}
        </Stack>
      </SurfaceCard>
      <ApprovalFlowRules />
    </Stack>
  );
}

function ApprovalHotItemCard({ item }: Readonly<{ item: ApprovalItem }>) {
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
        {getApprovalTypeLabel(item.approvalType)}
      </Text>
      <Heading mt="8px" size="sm">
        {item.approvalId}
      </Heading>
      <Text mt="8px" color="ink.500">
        {item.requesterRole} · {formatUsdc(item.amountUsdc)} USDC
      </Text>
      <Stack mt="12px" direction="row" gap="8px" flexWrap="wrap">
        <SentinelStatusChip
          label={item.approvalLevel}
          tone={getApprovalLevelTone(item.approvalLevel)}
        />
        <SentinelStatusChip
          label={getApprovalStatusLabel(item.status)}
          tone={getApprovalStatusTone(item.status)}
        />
      </Stack>
    </Box>
  );
}

function ApprovalFlowRules() {
  return (
    <SurfaceCard
      eyebrow="Flow Rules"
      title="审批分级"
      description="读取权限和审批权限完全解耦，统一队列只负责总览，深度证据仍去专用工作台。"
    >
      <Stack gap="12px">
        <Text color="ink.500">
          `provider manual review`
          先在统一队列暴露风险面，保证负责人能在一个面板看到需要处理的资金动作。
        </Text>
        <Text color="ink.500">
          需要 evidence summary、reviewer note
          和更细风险上下文时，再跳转到专用提现审核面板做决定。
        </Text>
        <Text color="ink.500">
          执行环节继续和审批环节拆开，避免 reviewer 在信息不足时直接撞执行系统。
        </Text>
      </Stack>
    </SurfaceCard>
  );
}
