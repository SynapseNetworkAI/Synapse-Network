import { Box, Grid, Heading, Stack, Text } from "@chakra-ui/react";

import {
  OverlayPanel,
  SentinelStatusChip,
  SurfaceCard,
} from "@/components/console-ui";
import { formatDateTime, formatUsdc, inputText } from "@/lib/admin-console";

import {
  getReviewDecisionLabel,
  getReviewDecisionTone,
  getReviewHistoryStatusLabel,
  getReviewHistoryStatusTone,
  type ReviewHistoryFlowStep,
} from "./review-history-presenters";
import type { useReviewHistory } from "./use-review-history";

type ReviewHistoryState = ReturnType<typeof useReviewHistory>;

export function ReviewHistoryDetailPanel({
  history,
}: Readonly<{ history: ReviewHistoryState }>) {
  const activeItem = history.activeItem;

  return (
    <OverlayPanel
      open={history.isDetailOpen && activeItem !== null}
      title={activeItem?.withdrawalId ?? "审核详情"}
      description="下钻查看这笔提现的完整 evidence、风险标签和状态流转。"
      onClose={history.closeDetail}
    >
      {activeItem ? (
        <Stack gap="14px">
          <ReviewHistoryEvidenceCard history={history} />
          <ReviewHistoryFactGrid history={history} />
          <ReviewHistoryNotes history={history} />
          <ReviewHistoryFlowCard steps={history.activeFlow} />
        </Stack>
      ) : null}
    </OverlayPanel>
  );
}

function ReviewHistoryEvidenceCard({
  history,
}: Readonly<{ history: ReviewHistoryState }>) {
  const activeItem = history.activeItem;
  if (!activeItem) {
    return null;
  }

  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Stack direction="row" justify="space-between" align="center">
        <Text
          fontSize="11px"
          letterSpacing="0.16em"
          textTransform="uppercase"
          color="ink.500"
        >
          Evidence Summary
        </Text>
        <Stack direction="row" gap="8px">
          <SentinelStatusChip
            label={getReviewDecisionLabel(activeItem.reviewDecision)}
            tone={getReviewDecisionTone(activeItem.reviewDecision)}
          />
          <SentinelStatusChip
            label={getReviewHistoryStatusLabel(activeItem.currentStatus)}
            tone={getReviewHistoryStatusTone(activeItem.currentStatus)}
          />
        </Stack>
      </Stack>
      <Heading mt="10px" size="sm">
        {inputText(activeItem.evidenceSummary ?? activeItem.message)}
      </Heading>
      <Text mt="8px" color="ink.500">
        风险等级 {inputText(activeItem.riskLevel)} · 原因标签{" "}
        {inputText(activeItem.riskReasonCode)}
      </Text>
    </Box>
  );
}

function ReviewHistoryFactGrid({
  history,
}: Readonly<{ history: ReviewHistoryState }>) {
  const activeItem = history.activeItem;
  if (!activeItem) {
    return null;
  }

  const facts = [
    ["用户地址", inputText(activeItem.ownerAddress)],
    ["提现金额", `${formatUsdc(activeItem.amountUsdc ?? "0")} USDC`],
    ["申请编号", inputText(activeItem.requestId)],
    ["交易哈希", inputText(activeItem.txHash)],
    ["处理人", inputText(activeItem.reviewerEmail)],
    ["处理角色", inputText(activeItem.reviewerRole)],
  ];

  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="10px">
      {facts.map(([label, value]) => (
        <FactCard key={label} label={label} value={value} />
      ))}
    </Grid>
  );
}

function ReviewHistoryNotes({
  history,
}: Readonly<{ history: ReviewHistoryState }>) {
  const activeItem = history.activeItem;
  if (!activeItem) {
    return null;
  }

  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Text
        fontSize="11px"
        letterSpacing="0.16em"
        textTransform="uppercase"
        color="ink.500"
      >
        处理备注
      </Text>
      <Text mt="10px">{inputText(activeItem.reviewerNote)}</Text>
      <Text mt="8px" color="ink.500">
        系统说明：{inputText(activeItem.message)}
      </Text>
    </Box>
  );
}

function ReviewHistoryFlowCard({
  steps,
}: Readonly<{ steps: ReviewHistoryFlowStep[] }>) {
  return (
    <SurfaceCard
      eyebrow="Status Replay"
      title="状态流转"
      description="把申请进入人工审核、reviewer 决策和当前提现状态串成一条业务时间线。"
    >
      <Stack gap="12px">
        {steps.map((step, index) => (
          <ReviewHistoryFlowItem
            key={step.key}
            index={index}
            step={step}
            total={steps.length}
          />
        ))}
      </Stack>
    </SurfaceCard>
  );
}

function ReviewHistoryFlowItem({
  index,
  step,
  total,
}: Readonly<{
  index: number;
  step: ReviewHistoryFlowStep;
  total: number;
}>) {
  return (
    <Box position="relative" pl="28px">
      {index < total - 1 ? (
        <Box
          position="absolute"
          left="9px"
          top="22px"
          bottom="-18px"
          w="2px"
          bg="rgba(99,92,82,0.14)"
        />
      ) : null}
      <Box
        position="absolute"
        left="0"
        top="7px"
        w="20px"
        h="20px"
        borderRadius="full"
        bg={getFlowDotBackground(step.tone)}
        border="1px solid rgba(99,92,82,0.12)"
      />
      <Box
        borderRadius="18px"
        p="14px 16px"
        bg="rgba(255,255,255,0.74)"
        border="1px solid rgba(99,92,82,0.10)"
      >
        <Stack
          direction={{ base: "column", md: "row" }}
          justify="space-between"
          align={{ base: "flex-start", md: "center" }}
          gap="8px"
        >
          <Heading size="sm">{step.label}</Heading>
          <SentinelStatusChip
            label={
              step.timestamp ? formatDateTime(step.timestamp) : "等待时间戳"
            }
            tone={step.tone}
          />
        </Stack>
        <Text mt="8px" color="ink.500">
          {step.detail}
        </Text>
      </Box>
    </Box>
  );
}

function FactCard({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Text
        fontSize="11px"
        letterSpacing="0.16em"
        textTransform="uppercase"
        color="ink.500"
      >
        {label}
      </Text>
      <Heading mt="10px" size="sm">
        {value}
      </Heading>
    </Box>
  );
}

function getFlowDotBackground(
  tone: "green" | "orange" | "red" | "gray"
): string {
  if (tone === "green") {
    return "rgba(31,146,87,0.18)";
  }
  if (tone === "red") {
    return "rgba(184,49,49,0.16)";
  }
  if (tone === "gray") {
    return "rgba(99,92,82,0.14)";
  }
  return "rgba(243,106,29,0.16)";
}
