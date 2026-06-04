"use client";

import {
  Box,
  Button,
  Grid,
  HStack,
  Link as ChakraLink,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";

import {
  EmptyBlock,
  MetricCard,
  SentinelStatusChip,
  SurfaceCard,
} from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import type { ForumResponseTask } from "@/services/admin-api";

import {
  canIgnoreForumTask,
  canSendForumReply,
  priorityTone,
  responseTaskBody,
  responseTaskClassificationLabel,
  responseTaskContextMeta,
  responseTaskContextStamp,
  responseTaskContextTitle,
  responseTaskMeta,
  responseTaskStatusLabel,
  responseTaskTone,
  responseTaskTitle,
} from "./forum-support-presenters";
import type { useForumSupportActions } from "./use-forum-support-actions";
import type { useForumSupportData } from "./use-forum-support-data";

type ForumData = ReturnType<typeof useForumSupportData>;
type ForumActions = ReturnType<typeof useForumSupportActions>;

export function ForumResponseQueue({
  data,
  actions,
}: Readonly<{ data: ForumData; actions: ForumActions }>) {
  return (
    <>
      <QueueMetricGrid data={data} />
      <Grid
        templateColumns={{ base: "1fr", xl: "420px minmax(0, 1fr)" }}
        gap="18px"
        alignItems="start"
      >
        <ResponseTaskList data={data} />
        <Stack gap="16px">
          <ResponseTaskContext data={data} />
          <ResponseComposer data={data} actions={actions} />
        </Stack>
      </Grid>
    </>
  );
}

function QueueMetricGrid({ data }: Readonly<{ data: ForumData }>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(4, 1fr)" }} gap="16px">
      <MetricCard
        label="Queue"
        value={data.queueMetrics.total}
        meta="当前筛选下的回复任务"
      />
      <MetricCard
        label="Draft ready"
        value={data.queueMetrics.draftReady}
        meta="Agent 草稿已生成"
      />
      <MetricCard
        label="Bug signals"
        value={data.queueMetrics.bugs}
        meta="可能需要进入候选需求池"
      />
      <MetricCard
        label="High priority"
        value={data.queueMetrics.highRisk}
        meta="需要优先处理"
      />
    </Grid>
  );
}

function ResponseTaskList({ data }: Readonly<{ data: ForumData }>) {
  return (
    <SurfaceCard
      eyebrow={data.view === "history" ? "Response History" : "Response Queue"}
      title={data.view === "history" ? "历史任务" : "未回复队列"}
      description="列表只承载处理优先级；点击后在右侧审核 Agent 建议和发送公开回复。"
      stamp={`${data.tasks.length} tasks`}
    >
      {data.tasks.length === 0 ? (
        <EmptyBlock
          title="当前没有待处理帖子"
          description="新发帖会自动进入 awaiting_response；Growing 推送草稿后会变为 draft_ready。"
        />
      ) : (
        <Stack gap="10px">
          {data.tasks.map((item) => (
            <ResponseTaskRow
              key={item.responseTaskId}
              task={item}
              selectedTaskId={data.selectedTask?.responseTaskId ?? null}
              onSelect={data.setSelectedTaskId}
            />
          ))}
        </Stack>
      )}
    </SurfaceCard>
  );
}

function ResponseTaskRow({
  task,
  selectedTaskId,
  onSelect,
}: Readonly<{
  task: ForumResponseTask;
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
}>) {
  const selected = selectedTaskId === task.responseTaskId;
  return (
    <Box
      as="button"
      textAlign="left"
      border="1px solid"
      borderColor={selected ? "rgba(42,99,235,0.50)" : "rgba(15,23,42,0.10)"}
      borderRadius="18px"
      bg={selected ? "rgba(42,99,235,0.08)" : "rgba(255,255,255,0.82)"}
      p="14px"
      onClick={() => onSelect(task.responseTaskId)}
    >
      <HStack justifyContent="space-between" alignItems="start">
        <Box>
          <Text fontWeight="800">{responseTaskTitle(task)}</Text>
          <Text color="ink.500" mt="4px">
            {responseTaskMeta(task)}
          </Text>
        </Box>
        <SentinelStatusChip
          label={responseTaskStatusLabel(task)}
          tone={responseTaskTone(task.status)}
        />
      </HStack>
      <HStack mt="10px" gap="8px" flexWrap="wrap">
        <SentinelStatusChip
          label={task.priority}
          tone={priorityTone(task.priority)}
        />
        <SentinelStatusChip
          label={responseTaskClassificationLabel(task)}
          tone="gray"
        />
      </HStack>
    </Box>
  );
}

function ResponseTaskContext({ data }: Readonly<{ data: ForumData }>) {
  const task = data.selectedTask;
  return (
    <SurfaceCard
      eyebrow="Topic Context"
      title={responseTaskContextTitle(task)}
      description="发帖人必须收到反馈；这里展示原帖上下文和是否已生成 Agent 建议。"
      stamp={responseTaskContextStamp(task)}
    >
      {task ? (
        <SelectedResponseTaskContext data={data} task={task} />
      ) : (
        <EmptyBlock
          title="没有选中帖子"
          description="队列为空，或者当前筛选条件下没有未回复记录。"
        />
      )}
    </SurfaceCard>
  );
}

function SelectedResponseTaskContext({
  data,
  task,
}: Readonly<{ data: ForumData; task: ForumResponseTask }>) {
  return (
    <Stack gap="12px">
      <ResponseTaskChips task={task} />
      <Text color="ink.500">
        {responseTaskContextMeta(task)} ·{" "}
        {formatDateTime(task.topic?.createdAt ?? null)}
      </Text>
      <Box
        borderRadius="16px"
        bg="rgba(245,247,251,0.92)"
        p="14px"
        whiteSpace="pre-wrap"
      >
        {responseTaskBody(task)}
      </Box>
      <ForumGrowingLinks data={data} />
    </Stack>
  );
}

function ResponseTaskChips({ task }: Readonly<{ task: ForumResponseTask }>) {
  return (
    <HStack gap="8px" flexWrap="wrap">
      <SentinelStatusChip
        label={responseTaskStatusLabel(task)}
        tone={responseTaskTone(task.status)}
      />
      <SentinelStatusChip
        label={task.priority}
        tone={priorityTone(task.priority)}
      />
      <SentinelStatusChip
        label={responseTaskClassificationLabel(task)}
        tone="gray"
      />
    </HStack>
  );
}

function ForumGrowingLinks({ data }: Readonly<{ data: ForumData }>) {
  return (
    <HStack gap="10px" flexWrap="wrap">
      {data.growingLinks.length === 0 ? (
        <Text color="ink.500" fontSize="13px">
          暂无 Growing Candidate / Requirement / Workflow 链接。
        </Text>
      ) : null}
      {data.growingLinks.map((link) => (
        <ChakraLink
          key={link.key}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          border="1px solid rgba(15,23,42,0.14)"
          borderRadius="999px"
          px="12px"
          py="7px"
          fontWeight="700"
          _hover={{ textDecoration: "none", bg: "rgba(42,99,235,0.08)" }}
        >
          {link.label}
        </ChakraLink>
      ))}
    </HStack>
  );
}

function ResponseComposer({
  data,
  actions,
}: Readonly<{ data: ForumData; actions: ForumActions }>) {
  return (
    <SurfaceCard
      eyebrow="Human Reviewed Reply"
      title={data.isHistoryMode ? "历史记录" : "审核并发送"}
      description={
        data.isHistoryMode
          ? "历史任务只读，避免重复公开回复；如需追溯请查看原帖和审计记录。"
          : "Agent 草稿只是建议。管理员可编辑后以 Synapse Ops 身份回复；发送后帖子会进入 answered。"
      }
      stamp={
        data.selectedTask?.suggestedReplySource === "growing"
          ? "agent draft"
          : "manual"
      }
    >
      <Stack gap="12px">
        <Textarea
          minH="180px"
          value={actions.replyBody}
          onChange={(event) => actions.setReplyBody(event.target.value)}
          readOnly={!data.selectedTaskActionable}
          placeholder={
            data.isHistoryMode
              ? "历史任务不可编辑。"
              : "这里会显示 Agent 建议回复；没有建议时也可以直接手写回复。"
          }
        />
        <ResponseActions data={data} actions={actions} />
        <Text color="ink.500" fontSize="13px">
          高风险、资金、auth、生产类问题不要在公开回复中承诺根因或赔付；先给出已收到、需要补充信息或会转人工处理的安全表述。
        </Text>
      </Stack>
    </SurfaceCard>
  );
}

function ResponseActions({
  data,
  actions,
}: Readonly<{ data: ForumData; actions: ForumActions }>) {
  return (
    <HStack
      justifyContent="space-between"
      alignItems="start"
      gap="12px"
      flexWrap="wrap"
    >
      <Box flex="1" minW="260px">
        <Textarea
          minH="70px"
          value={actions.ignoreReason}
          onChange={(event) => actions.setIgnoreReason(event.target.value)}
          readOnly={!data.selectedTaskActionable}
          placeholder="忽略原因，选择忽略时必填。"
        />
      </Box>
      <HStack>
        <Button
          colorPalette="green"
          onClick={() => void actions.sendReply()}
          disabled={
            !canSendForumReply(
              data.selectedTask,
              actions.replyBody,
              actions.busy
            )
          }
        >
          发送回复
        </Button>
        <Button
          variant="outline"
          onClick={() => void actions.ignoreTask()}
          disabled={
            !canIgnoreForumTask(
              data.selectedTask,
              actions.ignoreReason,
              actions.busy
            )
          }
        >
          忽略
        </Button>
      </HStack>
    </HStack>
  );
}
