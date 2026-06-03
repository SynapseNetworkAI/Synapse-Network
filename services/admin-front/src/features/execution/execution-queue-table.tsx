"use client";

import { Box, Button, Grid, Stack, Text } from "@chakra-ui/react";

import {
  DataTable,
  SearchInput,
  SentinelStatusChip,
  SurfaceCard,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
  nativeFieldStyle,
} from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import type { ExecutionJobItem } from "@/services/admin-api";

import {
  getExecutionRetryActionLabel,
  getExecutionStatusLabel,
  getExecutionTone,
  isExecutionJobRetryable,
} from "./execution-presenters";

export function ExecutionQueueTable({
  jobs,
  onRetry,
  retryingJobId,
  search,
  setSearch,
  setStatusFilter,
  setTargetFilter,
  statusFilter,
  targetFilter,
  targetOptions,
  totalJobs,
}: Readonly<{
  jobs: ExecutionJobItem[];
  onRetry: (job: ExecutionJobItem) => Promise<void>;
  retryingJobId: string | null;
  search: string;
  setSearch: (value: string) => void;
  setStatusFilter: (value: string) => void;
  setTargetFilter: (value: string) => void;
  statusFilter: string;
  targetFilter: string;
  targetOptions: string[];
  totalJobs: number;
}>) {
  return (
    <SurfaceCard
      eyebrow="Execution Queue"
      title="执行任务工作台"
      description="优先暴露失败和重试热点，让 operator 先收敛故障面，再处理尾部成功任务。"
      stamp={`${jobs.length}/${totalJobs} jobs`}
    >
      <ExecutionQueueFilters
        search={search}
        setSearch={setSearch}
        setStatusFilter={setStatusFilter}
        setTargetFilter={setTargetFilter}
        statusFilter={statusFilter}
        targetFilter={targetFilter}
        targetOptions={targetOptions}
      />
      <DataTable>
        <TableHeaderRow>
          <Th>任务</Th>
          <Th>目标</Th>
          <Th>状态</Th>
          <Th>Retry</Th>
          <Th>尝试</Th>
          <Th>动作</Th>
        </TableHeaderRow>
        <TableBody>
          {jobs.map((job) => (
            <ExecutionQueueRow
              job={job}
              key={job.jobId}
              onRetry={onRetry}
              retryingJobId={retryingJobId}
            />
          ))}
        </TableBody>
      </DataTable>
    </SurfaceCard>
  );
}

function ExecutionQueueFilters({
  search,
  setSearch,
  setStatusFilter,
  setTargetFilter,
  statusFilter,
  targetFilter,
  targetOptions,
}: Readonly<{
  search: string;
  setSearch: (value: string) => void;
  setStatusFilter: (value: string) => void;
  setTargetFilter: (value: string) => void;
  statusFilter: string;
  targetFilter: string;
  targetOptions: string[];
}>) {
  return (
    <Grid
      templateColumns={{ base: "1fr", xl: "minmax(0, 320px) 180px 180px" }}
      gap="12px"
      mb="16px"
    >
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="搜索 job / approval / error code"
      />
      <select
        value={statusFilter}
        onChange={(event) => setStatusFilter(event.target.value)}
        style={nativeFieldStyle}
      >
        <option value="all">全部状态</option>
        <option value="FAILED">FAILED</option>
        <option value="RUNNING">RUNNING</option>
        <option value="EXECUTING">EXECUTING</option>
        <option value="QUEUED">QUEUED</option>
        <option value="SUCCEEDED">SUCCEEDED</option>
      </select>
      <select
        value={targetFilter}
        onChange={(event) => setTargetFilter(event.target.value)}
        style={nativeFieldStyle}
      >
        <option value="all">全部目标</option>
        {targetOptions.map((target) => (
          <option key={target} value={target}>
            {target}
          </option>
        ))}
      </select>
    </Grid>
  );
}

function ExecutionQueueRow({
  job,
  onRetry,
  retryingJobId,
}: Readonly<{
  job: ExecutionJobItem;
  onRetry: (job: ExecutionJobItem) => Promise<void>;
  retryingJobId: string | null;
}>) {
  const retryable = isExecutionJobRetryable(job);
  const isRetrying = retryingJobId === job.jobId;

  return (
    <Box as="tr">
      <Td>
        <Text fontWeight="700">{job.jobId}</Text>
        <Text color="ink.500">approval {job.approvalId}</Text>
      </Td>
      <Td>
        <Text>{job.targetSystem}</Text>
        <Text color="ink.500">{job.executionType}</Text>
      </Td>
      <Td>
        <SentinelStatusChip
          label={getExecutionStatusLabel(job.status)}
          tone={getExecutionTone(job.status)}
        />
        <Text mt="8px" color="ink.500">
          updated {formatDateTime(job.updatedAt)}
        </Text>
      </Td>
      <Td>
        <Text fontWeight="700">
          {job.retryCount} / {job.maxRetryCount}
        </Text>
        <Text color="ink.500">{job.errorCode ?? "last attempt clean"}</Text>
      </Td>
      <Td>
        <Stack gap="6px">
          {job.attempts.slice(0, 2).map((attempt) => (
            <Box
              key={attempt.attemptNo}
              borderRadius="14px"
              p="10px"
              bg="rgba(247,241,233,0.74)"
            >
              <Text fontWeight="700">attempt #{attempt.attemptNo}</Text>
              <Text color="ink.500">
                {attempt.status} · {attempt.errorCode ?? "ok"}
              </Text>
            </Box>
          ))}
        </Stack>
      </Td>
      <Td>
        <Button
          size="sm"
          borderRadius="full"
          bg={retryable ? "brand.500" : "rgba(15,17,21,0.08)"}
          color={retryable ? "white" : "ink.500"}
          _hover={retryable ? { bg: "brand.600" } : undefined}
          disabled={!retryable || isRetrying}
          onClick={() => void onRetry(job)}
        >
          {getExecutionRetryActionLabel({ isRetrying, retryable })}
        </Button>
      </Td>
    </Box>
  );
}
