"use client";

import { Box, Heading, Stack, Text } from "@chakra-ui/react";

import { SentinelStatusChip, SurfaceCard } from "@/components/console-ui";

import {
  getExecutionTargetCardTone,
  type buildExecutionTargetCards,
} from "./execution-presenters";

type ExecutionTargetCard = ReturnType<typeof buildExecutionTargetCards>[number];

export function ExecutionTargetDomains({
  cards,
}: Readonly<{ cards: ExecutionTargetCard[] }>) {
  return (
    <SurfaceCard
      eyebrow="Target Domains"
      title="目标系统分布"
      description="把失败与处理中任务按目标系统切开，快速判断是 adapter 故障、worker 拥塞还是单个命令退化。"
    >
      <Stack gap="12px">
        {cards.map((card) => (
          <ExecutionTargetDomainCard card={card} key={card.key} />
        ))}
      </Stack>
    </SurfaceCard>
  );
}

function ExecutionTargetDomainCard({
  card,
}: Readonly<{ card: ExecutionTargetCard }>) {
  return (
    <Box
      borderRadius="22px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Stack direction="row" justify="space-between" align="center">
        <Heading size="sm">{card.label}</Heading>
        <SentinelStatusChip
          label={`${card.totalCount} jobs`}
          tone={getExecutionTargetCardTone(card)}
        />
      </Stack>
      <Text mt="8px" color="ink.500">
        failed {card.failedCount} · inflight {card.inflightCount}
      </Text>
    </Box>
  );
}
