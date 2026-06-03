"use client";

import { Box, Heading, Stack, Text } from "@chakra-ui/react";

import { SurfaceCard } from "@/components/console-ui";
import type { topAuditErrorCodes } from "./audit-presenters";

const auditGuardrails = [
  "审批人与执行人分离必须在审计链中可被证明。",
  "重试 execution job 必须留下 reviewer note 与 OTP 保护痕迹。",
  "配置中心的 draft / published 切换需要形成完整的 operator trail。",
];

type AuditErrorCode = ReturnType<typeof topAuditErrorCodes>[number];

export function AuditInsightsPanel({
  errorCodes,
}: Readonly<{ errorCodes: AuditErrorCode[] }>) {
  return (
    <Stack gap="16px">
      <AuditGuardrailCard />
      <AuditErrorClusters errorCodes={errorCodes} />
    </Stack>
  );
}

function AuditGuardrailCard() {
  return (
    <SurfaceCard
      eyebrow="Guardrail"
      title="Why this page matters"
      description="没有完整审计链路的管理后台，迟早会在提现、退款和配置发布上出事故。"
    >
      <Stack gap="12px">
        {auditGuardrails.map((item) => (
          <Box
            key={item}
            borderRadius="20px"
            p="16px"
            bg="rgba(255,255,255,0.74)"
            border="1px solid rgba(99,92,82,0.10)"
          >
            <Text>{item}</Text>
          </Box>
        ))}
      </Stack>
    </SurfaceCard>
  );
}

function AuditErrorClusters({
  errorCodes,
}: Readonly<{ errorCodes: AuditErrorCode[] }>) {
  return (
    <SurfaceCard
      eyebrow="Error Clusters"
      title="高频错误码"
      description="先看聚集错误，再决定是 reviewer 误操作、权限配置问题，还是执行链路本身在退化。"
    >
      <Stack gap="12px">
        {errorCodes.length === 0 ? (
          <AuditEmptyErrorCluster />
        ) : (
          errorCodes.map((item) => (
            <AuditErrorClusterCard item={item} key={item.errorCode} />
          ))
        )}
      </Stack>
    </SurfaceCard>
  );
}

function AuditEmptyErrorCluster() {
  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Text color="ink.500">
        当前窗口内没有聚集错误码，说明控制面的失败主要不是由同一类错误重复引起。
      </Text>
    </Box>
  );
}

function AuditErrorClusterCard({ item }: Readonly<{ item: AuditErrorCode }>) {
  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Heading size="sm">{item.errorCode}</Heading>
      <Text mt="8px" color="ink.500">
        {item.count} events in current window
      </Text>
    </Box>
  );
}
