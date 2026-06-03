"use client";

import {
  Box,
  Button,
  Grid,
  HStack,
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
import type { ForumTopicContext } from "@/services/admin-api";

import { topicStatusLabels, topicTone } from "./forum-support-presenters";
import type { ForumPinnedFilter } from "./forum-support-types";
import type { useForumSupportActions } from "./use-forum-support-actions";
import type { useForumSupportData } from "./use-forum-support-data";

type ForumData = ReturnType<typeof useForumSupportData>;
type ForumActions = ReturnType<typeof useForumSupportActions>;

export function ForumTopicWorkbench({
  data,
  actions,
}: Readonly<{ data: ForumData; actions: ForumActions }>) {
  return (
    <>
      <TopicMetricGrid data={data} />
      <Grid
        templateColumns={{ base: "1fr", xl: "minmax(0, 1fr) 460px" }}
        gap="18px"
        alignItems="start"
      >
        <ForumTopicListPanel data={data} busy={actions.busy} />
        <Stack gap="16px">
          <ForumTopicDetailPanel data={data} />
          <ForumTopicModerationPanel data={data} actions={actions} />
          <ForumTopicTimelinePanel data={data} />
        </Stack>
      </Grid>
    </>
  );
}

function TopicMetricGrid({ data }: Readonly<{ data: ForumData }>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(5, 1fr)" }} gap="16px">
      <MetricCard
        label="Open"
        value={data.topicMetrics.open}
        meta="当前筛选下未隐藏且未关闭"
      />
      <MetricCard
        label="Awaiting admin"
        value={data.topicMetrics.awaitingAdmin}
        meta="需要官方回复"
      />
      <MetricCard
        label="Draft ready"
        value={data.queueMetrics.draftReady}
        meta="Agent 回复草稿"
      />
      <MetricCard
        label="Closed"
        value={data.topicMetrics.closed}
        meta="已关闭讨论"
      />
      <MetricCard
        label="Pinned"
        value={data.topicMetrics.pinned}
        meta="公开列表置顶"
      />
    </Grid>
  );
}

function ForumTopicListPanel({
  data,
  busy,
}: Readonly<{ data: ForumData; busy: boolean }>) {
  return (
    <SurfaceCard
      eyebrow="All Topics"
      title="帖子生命周期"
      description="分页查看所有公开讨论，按状态、搜索和置顶筛选；点击行后在右侧管理关闭、重开和置顶。"
      stamp={`page ${data.topicPage}/${data.topicTotalPages}`}
    >
      <Stack gap="12px">
        <ForumTopicFilters data={data} />
        {data.topics.length === 0 ? (
          <EmptyBlock
            title="没有匹配帖子"
            description="调整筛选条件，或等待用户在公开 Forum 发帖。"
          />
        ) : (
          <Stack gap="10px">
            {data.topics.map((topic) => (
              <ForumTopicRow
                key={topic.topicId}
                topic={topic}
                selectedTopicId={data.selectedTopic?.topicId ?? null}
                onSelect={data.setSelectedTopicId}
              />
            ))}
          </Stack>
        )}
        <ForumTopicPagination data={data} busy={busy} />
      </Stack>
    </SurfaceCard>
  );
}

function ForumTopicFilters({ data }: Readonly<{ data: ForumData }>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "1.4fr 1fr 1fr" }} gap="10px">
      <input
        value={data.topicQuery}
        onChange={(event) => data.setTopicQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            data.setTopicPage(1);
            void data.refreshTopics();
          }
        }}
        placeholder="搜索标题、正文、作者..."
        style={topicFilterStyle}
      />
      <select
        value={data.topicStatus}
        onChange={(event) => {
          data.setTopicPage(1);
          data.setTopicStatus(event.target.value);
        }}
        style={topicFilterStyle}
      >
        <option value="open,awaiting_admin,answered,resolved">
          Active public
        </option>
        <option value="awaiting_admin">Awaiting admin</option>
        <option value="answered,resolved">Answered / resolved</option>
        <option value="closed">Closed</option>
        <option value="hidden">Hidden</option>
        <option value="open,awaiting_admin,answered,resolved,closed,hidden,locked">
          All statuses
        </option>
      </select>
      <select
        value={data.topicPinnedFilter}
        onChange={(event) => {
          data.setTopicPage(1);
          data.setTopicPinnedFilter(event.target.value as ForumPinnedFilter);
        }}
        style={topicFilterStyle}
      >
        <option value="all">All pin states</option>
        <option value="pinned">Pinned only</option>
        <option value="unpinned">Unpinned only</option>
      </select>
    </Grid>
  );
}

function ForumTopicRow({
  topic,
  selectedTopicId,
  onSelect,
}: Readonly<{
  topic: ForumTopicContext;
  selectedTopicId: string | null;
  onSelect: (topicId: string) => void;
}>) {
  const selected = selectedTopicId === topic.topicId;
  return (
    <Box
      as="button"
      textAlign="left"
      border="1px solid"
      borderColor={selected ? "rgba(42,99,235,0.50)" : "rgba(15,23,42,0.10)"}
      borderRadius="18px"
      bg={selected ? "rgba(42,99,235,0.08)" : "rgba(255,255,255,0.82)"}
      p="14px"
      onClick={() => onSelect(topic.topicId)}
    >
      <HStack justifyContent="space-between" alignItems="start" gap="12px">
        <Box minW="0">
          <Text fontWeight="800">{topic.title}</Text>
          <Text color="ink.500" mt="4px">
            {topic.excerpt}
          </Text>
          <Text color="ink.500" mt="8px" fontSize="13px">
            {topic.category} · {topic.authorDisplay} ·{" "}
            {formatDateTime(topic.lastActivityAt)}
          </Text>
        </Box>
        <Stack alignItems="end" gap="6px">
          <SentinelStatusChip
            label={topicStatusLabels[topic.status] ?? topic.status}
            tone={topicTone(topic.status)}
          />
          {topic.pinned ? (
            <SentinelStatusChip label="Pinned" tone="green" />
          ) : null}
        </Stack>
      </HStack>
      <HStack
        mt="10px"
        gap="8px"
        flexWrap="wrap"
        color="ink.500"
        fontSize="13px"
      >
        <Text>{topic.repliesCount} replies</Text>
        <Text>{topic.viewsCount} views</Text>
        <Text>{topic.officialRepliesCount} official</Text>
      </HStack>
    </Box>
  );
}

function ForumTopicPagination({
  data,
  busy,
}: Readonly<{ data: ForumData; busy: boolean }>) {
  return (
    <HStack justifyContent="space-between">
      <Button
        variant="outline"
        disabled={data.topicPage <= 1 || busy}
        onClick={() => data.setTopicPage((page) => Math.max(1, page - 1))}
      >
        上一页
      </Button>
      <Text color="ink.500" fontSize="13px">
        第 {data.topicPage} / {data.topicTotalPages} 页
      </Text>
      <Button
        variant="outline"
        disabled={data.topicPage >= data.topicTotalPages || busy}
        onClick={() => data.setTopicPage((page) => page + 1)}
      >
        下一页
      </Button>
    </HStack>
  );
}

function ForumTopicDetailPanel({ data }: Readonly<{ data: ForumData }>) {
  const topic = data.selectedTopic;
  return (
    <SurfaceCard
      eyebrow="Topic Detail"
      title={topic?.title ?? "选择一个帖子"}
      description="关闭不会隐藏帖子，只会锁定继续回复；隐藏是单独 moderation 行为。"
      stamp={topic?.topicId ?? "no selection"}
    >
      {topic ? (
        <ForumTopicDetail topic={topic} />
      ) : (
        <EmptyBlock
          title="没有选中帖子"
          description="当前筛选没有可管理的帖子。"
        />
      )}
    </SurfaceCard>
  );
}

function ForumTopicDetail({ topic }: Readonly<{ topic: ForumTopicContext }>) {
  return (
    <Stack gap="12px">
      <HStack gap="8px" flexWrap="wrap">
        <SentinelStatusChip
          label={topicStatusLabels[topic.status] ?? topic.status}
          tone={topicTone(topic.status)}
        />
        {topic.pinned ? (
          <SentinelStatusChip label="Pinned" tone="green" />
        ) : null}
        {topic.resolved ? (
          <SentinelStatusChip label="Resolved" tone="green" />
        ) : null}
        {topic.locked ? (
          <SentinelStatusChip label="Locked" tone="gray" />
        ) : null}
      </HStack>
      <Text color="ink.500">
        {topic.authorDisplay} · {topic.category} ·{" "}
        {formatDateTime(topic.createdAt)}
      </Text>
      <Box
        borderRadius="16px"
        bg="rgba(245,247,251,0.92)"
        p="14px"
        whiteSpace="pre-wrap"
      >
        {topic.body || topic.excerpt}
      </Box>
      <HStack gap="12px" flexWrap="wrap" color="ink.500" fontSize="13px">
        <Text>{topic.viewsCount} views</Text>
        <Text>{topic.repliesCount} replies</Text>
        <Text>{topic.officialRepliesCount} official replies</Text>
      </HStack>
      {topic.closedReason ? (
        <Box
          borderRadius="16px"
          bg="rgba(15,23,42,0.06)"
          p="12px"
          color="ink.600"
          fontSize="14px"
        >
          关闭原因：{topic.closedReason}
        </Box>
      ) : null}
    </Stack>
  );
}

function ForumTopicModerationPanel({
  data,
  actions,
}: Readonly<{ data: ForumData; actions: ForumActions }>) {
  const topic = data.selectedTopic;
  return (
    <SurfaceCard
      eyebrow="Moderation Actions"
      title="状态与置顶"
      description="状态变更会写入 lifecycle timeline，方便后续审计和追踪。"
      stamp="manual only"
    >
      <Stack gap="12px">
        <Textarea
          minH="76px"
          value={actions.closeReason}
          onChange={(event) => actions.setCloseReason(event.target.value)}
          placeholder="关闭原因，关闭帖子时必填。"
        />
        <HStack flexWrap="wrap">
          <Button
            colorPalette="green"
            disabled={!topic || actions.busy}
            onClick={() => void actions.togglePinnedTopic()}
          >
            {topic?.pinned ? "取消置顶" : "置顶"}
          </Button>
          <Button
            variant="outline"
            disabled={!topic || topic.status !== "closed" || actions.busy}
            onClick={() => void actions.reopenTopic()}
          >
            重新打开
          </Button>
          <Button
            colorPalette="red"
            disabled={
              !topic ||
              topic.status === "closed" ||
              actions.closeReason.trim().length < 3 ||
              actions.busy
            }
            onClick={() => void actions.closeTopic()}
          >
            关闭帖子
          </Button>
        </HStack>
      </Stack>
    </SurfaceCard>
  );
}

function ForumTopicTimelinePanel({ data }: Readonly<{ data: ForumData }>) {
  const events = data.topicDetail?.events ?? [];
  return (
    <SurfaceCard
      eyebrow="Lifecycle Timeline"
      title="生命周期记录"
      description="谁在什么时候关闭、重开、置顶，都会作为事件留存。"
      stamp={`${events.length} events`}
    >
      {events.length ? (
        <Stack gap="8px">
          {events.map((event) => (
            <Box
              key={event.eventId}
              border="1px solid rgba(15,23,42,0.10)"
              borderRadius="14px"
              p="10px"
            >
              <Text fontWeight="800">{event.action}</Text>
              <Text color="ink.500" fontSize="13px">
                {event.actorAdminId ?? "system"} ·{" "}
                {formatDateTime(event.createdAt)} · {event.fromStatus ?? "-"} →{" "}
                {event.toStatus ?? "-"}
              </Text>
              {event.reason ? (
                <Text mt="4px" color="ink.500" fontSize="13px">
                  {event.reason}
                </Text>
              ) : null}
            </Box>
          ))}
        </Stack>
      ) : (
        <EmptyBlock
          title="暂无生命周期事件"
          description="关闭、重开、置顶或取消置顶后会出现在这里。"
        />
      )}
    </SurfaceCard>
  );
}

const topicFilterStyle = {
  border: "1px solid rgba(15,23,42,0.14)",
  borderRadius: "14px",
  height: "42px",
  padding: "0 12px",
};
