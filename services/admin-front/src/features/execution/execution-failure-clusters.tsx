"use client";

import { Box, Heading, Stack, Text } from "@chakra-ui/react";

import {
  EmptyBlock,
  SentinelStatusChip,
  SurfaceCard,
} from "@/components/console-ui";
import type { buildExecutionFailureClusters } from "./execution-presenters";

type FailureCluster = ReturnType<typeof buildExecutionFailureClusters>[number];

export function ExecutionFailureClusters({
  clusters,
}: Readonly<{ clusters: FailureCluster[] }>) {
  return (
    <SurfaceCard
      eyebrow="Failure Clusters"
      title="失败簇视图"
      description="这里先回答失败任务是否成簇，便于判断是单个命令异常还是同类执行路径一起退化。"
    >
      <Stack gap="12px">
        {clusters.length ? (
          clusters.map((cluster) => (
            <FailureClusterCard cluster={cluster} key={cluster.code} />
          ))
        ) : (
          <EmptyBlock
            title="没有失败簇"
            description="当前执行面没有失败任务，worker 和 controlled command 保持稳定。"
          />
        )}
        <ExecutionGuardrail />
      </Stack>
    </SurfaceCard>
  );
}

function FailureClusterCard({
  cluster,
}: Readonly<{ cluster: FailureCluster }>) {
  return (
    <Box
      borderRadius="22px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Stack direction="row" justify="space-between" align="center">
        <Heading size="sm">{cluster.code}</Heading>
        <SentinelStatusChip
          label={`${cluster.count} jobs`}
          tone={cluster.code === "unknown" ? "gray" : "red"}
        />
      </Stack>
      <Text mt="8px" color="ink.500">
        {cluster.jobIds.slice(0, 3).join(" / ")}
        {cluster.jobIds.length > 3 ? " ..." : ""}
      </Text>
    </Box>
  );
}

function ExecutionGuardrail() {
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
        Execution Guardrail
      </Text>
      <Text mt="8px" color="ink.500">
        所有资金或配置推进动作都必须从审批层进入 execution queue，前端只能请求
        retry，不能在这里直接替代系统调查或业务分诊。
      </Text>
    </Box>
  );
}
