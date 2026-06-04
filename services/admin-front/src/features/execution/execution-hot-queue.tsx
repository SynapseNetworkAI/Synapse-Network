"use client";

import { Box, Heading, Stack, Text } from "@chakra-ui/react";

import {
  EmptyBlock,
  SentinelStatusChip,
  SurfaceCard,
} from "@/components/console-ui";
import type { ExecutionJobItem } from "@/services/admin-api";

import {
  getExecutionStatusLabel,
  getExecutionTone,
} from "./execution-presenters";

export function ExecutionHotQueue({
  jobs,
}: Readonly<{ jobs: ExecutionJobItem[] }>) {
  return (
    <SurfaceCard
      eyebrow="Hot Queue"
      title="待处置热点"
      description="这里只保留最值得立即处理的失败或重试项，帮助值班人员快速收敛故障面。"
    >
      <Stack gap="12px">
        {jobs.length ? (
          jobs.map((job) => <ExecutionHotJobCard job={job} key={job.jobId} />)
        ) : (
          <EmptyBlock
            title="当前没有待处置热点"
            description="筛选结果为空，或者执行流处于稳定状态。"
          />
        )}
      </Stack>
    </SurfaceCard>
  );
}

function ExecutionHotJobCard({ job }: Readonly<{ job: ExecutionJobItem }>) {
  return (
    <Box
      borderRadius="22px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Stack direction="row" justify="space-between" align="center">
        <Stack gap="4px">
          <Heading size="sm">{job.jobId}</Heading>
          <Text color="ink.500">
            {job.executionType}
            {" -> "}
            {job.targetSystem}
          </Text>
        </Stack>
        <SentinelStatusChip
          label={getExecutionStatusLabel(job.status)}
          tone={getExecutionTone(job.status)}
        />
      </Stack>
      <Text mt="8px" color="ink.500">
        approval {job.approvalId} ·{" "}
        {job.errorMessage ?? "等待 operator 决定是否重试"}
      </Text>
    </Box>
  );
}
