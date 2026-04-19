"use client";

import { Box, Button, Grid, HStack, Link as ChakraLink, Stack, Text, Textarea } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { EmptyBlock, MessageBanner, MetricCard, SentinelStatusChip, SurfaceCard } from "@/components/console-ui";
import {
  buildForumGrowingLinks,
  buildForumSupportMetrics,
  canIgnoreForumTask,
  canSendForumReply,
  forumSupportModeFromStatus,
  forumSupportStatusForMode,
  isForumResponseTaskActionable,
  type ForumSupportStatusMode,
} from "@/features/forum-support/forum-support-presenters";
import { formatDateTime } from "@/lib/admin-console";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  closeForumTopic,
  getForumTopic,
  ignoreForumResponseTask,
  listForumResponseTasks,
  listForumTopics,
  pinForumTopic,
  reopenForumTopic,
  sendForumResponseReply,
  unpinForumTopic,
  type ForumResponseTask,
  type ForumTopicDetailResponse,
  type ForumTopicContext,
} from "@/services/admin-api";

type WorkbenchView = "topics" | "queue" | "history";

const responseTaskStatusLabels: Record<string, string> = {
  awaiting_response: "等待回复",
  draft_ready: "草稿就绪",
  responded: "已回复",
  ignored: "已忽略",
  closed: "已关闭",
};

const topicStatusLabels: Record<string, string> = {
  open: "开放",
  awaiting_admin: "待官方回复",
  answered: "已官方回复",
  resolved: "已解决",
  closed: "已关闭",
  hidden: "已隐藏",
  locked: "已锁定",
};

const classificationLabels: Record<string, string> = {
  question: "问题咨询",
  bug: "Bug",
  feature_request: "功能需求",
  docs_issue: "文档问题",
  needs_more_info: "需要补充信息",
  spam: "噪音",
};

function priorityTone(priority: string): "green" | "orange" | "red" | "gray" {
  if (priority === "critical" || priority === "high") return "red";
  if (priority === "normal") return "orange";
  return "gray";
}

function responseTaskTone(status: string): "green" | "orange" | "red" | "gray" {
  if (status === "draft_ready") return "green";
  if (status === "awaiting_response") return "orange";
  if (status === "ignored") return "gray";
  return "green";
}

function topicTone(status: string): "green" | "orange" | "red" | "gray" {
  if (status === "closed" || status === "hidden" || status === "locked") return "gray";
  if (status === "awaiting_admin") return "orange";
  if (status === "resolved" || status === "answered") return "green";
  return "green";
}

function metricCount(items: ForumTopicContext[], predicate: (item: ForumTopicContext) => boolean): number {
  return items.filter(predicate).length;
}

export default function ForumSupportPage() {
  const { admin, token, loading } = useAdminSession();
  const [view, setView] = useState<WorkbenchView>("topics");
  const [tasks, setTasks] = useState<ForumResponseTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [topics, setTopics] = useState<ForumTopicContext[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [topicDetail, setTopicDetail] = useState<ForumTopicDetailResponse | null>(null);
  const [topicPage, setTopicPage] = useState(1);
  const [topicTotalPages, setTopicTotalPages] = useState(1);
  const [topicStatus, setTopicStatus] = useState("open,awaiting_admin,answered,resolved");
  const [topicQuery, setTopicQuery] = useState("");
  const [topicPinnedFilter, setTopicPinnedFilter] = useState<"all" | "pinned" | "unpinned">("all");
  const [replyBody, setReplyBody] = useState("");
  const [ignoreReason, setIgnoreReason] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const taskMode: ForumSupportStatusMode = view === "history" ? "history" : "active";
  const taskStatus = forumSupportStatusForMode(taskMode);
  const isHistoryMode = forumSupportModeFromStatus(taskStatus) === "history";
  const selectedTask = useMemo(
    () => tasks.find((item) => item.responseTaskId === selectedTaskId) ?? tasks[0] ?? null,
    [tasks, selectedTaskId],
  );
  const selectedTaskActionable = isForumResponseTaskActionable(selectedTask);
  const queueMetrics = useMemo(() => buildForumSupportMetrics(tasks), [tasks]);
  const growingLinks = useMemo(() => buildForumGrowingLinks(selectedTask), [selectedTask]);
  const selectedTopic = topicDetail?.topic ?? topics.find((item) => item.topicId === selectedTopicId) ?? topics[0] ?? null;
  const topicMetrics = useMemo(() => ({
    open: metricCount(topics, (item) => item.status !== "closed" && item.status !== "hidden"),
    awaitingAdmin: metricCount(topics, (item) => item.status === "awaiting_admin"),
    closed: metricCount(topics, (item) => item.status === "closed"),
    pinned: metricCount(topics, (item) => item.pinned),
  }), [topics]);

  const refreshTasks = useCallback(async (activeToken = token) => {
    if (!activeToken) return;
    try {
      const response = await listForumResponseTasks(activeToken, { status: taskStatus, pageSize: 50 });
      setTasks(response.items);
      setSelectedTaskId((current) => {
        if (response.items.length === 0) return null;
        if (response.items.some((item) => item.responseTaskId === current)) return current;
        return response.items[0].responseTaskId;
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载社区回复队列失败");
    }
  }, [taskStatus, token]);

  const refreshTopics = useCallback(async (activeToken = token) => {
    if (!activeToken) return;
    try {
      const pinned = topicPinnedFilter === "all" ? undefined : topicPinnedFilter === "pinned";
      const response = await listForumTopics(activeToken, {
        status: topicStatus,
        q: topicQuery,
        pinned,
        page: topicPage,
        pageSize: 20,
      });
      setTopics(response.items);
      setTopicTotalPages(response.pagination.totalPages || 1);
      setSelectedTopicId((current) => {
        if (response.items.length === 0) return null;
        if (response.items.some((item) => item.topicId === current)) return current;
        return response.items[0].topicId;
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载论坛帖子列表失败");
    }
  }, [topicPage, topicPinnedFilter, topicQuery, topicStatus, token]);

  useEffect(() => {
    if (!token) return;
    if (view === "topics") {
      void refreshTopics(token);
      void refreshTasks(token);
      return;
    }
    void refreshTasks(token);
  }, [token, view, refreshTopics, refreshTasks]);

  useEffect(() => {
    if (!token || view !== "topics" || !selectedTopicId) {
      setTopicDetail(null);
      return;
    }
    let cancelled = false;
    getForumTopic(token, selectedTopicId)
      .then((response) => {
        if (!cancelled) setTopicDetail(response);
      })
      .catch((detailError) => {
        if (!cancelled) setError(detailError instanceof Error ? detailError.message : "加载帖子详情失败");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTopicId, token, view]);

  useEffect(() => {
    setReplyBody(selectedTask?.suggestedReply ?? "");
    setIgnoreReason("");
  }, [selectedTask?.responseTaskId, selectedTask?.suggestedReply]);

  if (loading || !admin) {
    return <ControlPlaneLoadingScreen title="Forum Support" message="正在加载社区支持运营台..." />;
  }

  async function sendReply() {
    if (!token || !selectedTask || !selectedTaskActionable) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const updated = await sendForumResponseReply(token, selectedTask.responseTaskId, {
        body: replyBody,
        authorDisplay: "Synapse Ops",
        authorAddress: "synapse:ops",
      });
      setNotice(updated.status === "responded" ? "官方回复已发送；帖子状态会进入 answered。" : `该任务已是 ${responseTaskStatusLabels[updated.status] ?? updated.status}，已刷新队列。`);
      await refreshTasks(token);
      await refreshTopics(token);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "发送回复失败");
    } finally {
      setBusy(false);
    }
  }

  async function ignoreTask() {
    if (!token || !selectedTask || !selectedTaskActionable) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const updated = await ignoreForumResponseTask(token, selectedTask.responseTaskId, { reason: ignoreReason });
      setNotice(updated.status === "ignored" ? "已忽略该帖子，未回复状态已消除。" : `该任务已是 ${responseTaskStatusLabels[updated.status] ?? updated.status}，已刷新队列。`);
      await refreshTasks(token);
    } catch (ignoreError) {
      setError(ignoreError instanceof Error ? ignoreError.message : "忽略帖子失败");
    } finally {
      setBusy(false);
    }
  }

  async function closeTopic() {
    if (!token || !selectedTopic || closeReason.trim().length < 3) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await closeForumTopic(token, selectedTopic.topicId, { reason: closeReason });
      setNotice("帖子已关闭，公开详情页仍可见但不再接受新回复。");
      setCloseReason("");
      await refreshTopics(token);
      setTopicDetail(null);
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "关闭帖子失败");
    } finally {
      setBusy(false);
    }
  }

  async function reopenTopic() {
    if (!token || !selectedTopic) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await reopenForumTopic(token, selectedTopic.topicId);
      setNotice("帖子已重新打开，用户可以继续回复。");
      await refreshTopics(token);
      setTopicDetail(null);
    } catch (reopenError) {
      setError(reopenError instanceof Error ? reopenError.message : "重新打开帖子失败");
    } finally {
      setBusy(false);
    }
  }

  async function togglePinnedTopic() {
    if (!token || !selectedTopic) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      if (selectedTopic.pinned) {
        await unpinForumTopic(token, selectedTopic.topicId);
        setNotice("帖子已取消置顶。");
      } else {
        await pinForumTopic(token, selectedTopic.topicId);
        setNotice("帖子已置顶，公开论坛列表会优先展示。");
      }
      await refreshTopics(token);
      setTopicDetail(null);
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : "更新置顶状态失败");
    } finally {
      setBusy(false);
    }
  }

  const renderTopicWorkbench = () => (
    <>
      <Grid templateColumns={{ base: "1fr", md: "repeat(5, 1fr)" }} gap="16px">
        <MetricCard label="Open" value={topicMetrics.open} meta="当前筛选下未隐藏且未关闭" />
        <MetricCard label="Awaiting admin" value={topicMetrics.awaitingAdmin} meta="需要官方回复" />
        <MetricCard label="Draft ready" value={queueMetrics.draftReady} meta="Agent 回复草稿" />
        <MetricCard label="Closed" value={topicMetrics.closed} meta="已关闭讨论" />
        <MetricCard label="Pinned" value={topicMetrics.pinned} meta="公开列表置顶" />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "minmax(0, 1fr) 460px" }} gap="18px" alignItems="start">
        <SurfaceCard
          eyebrow="All Topics"
          title="帖子生命周期"
          description="分页查看所有公开讨论，按状态、搜索和置顶筛选；点击行后在右侧管理关闭、重开和置顶。"
          stamp={`page ${topicPage}/${topicTotalPages}`}
        >
          <Stack gap="12px">
            <Grid templateColumns={{ base: "1fr", md: "1.4fr 1fr 1fr" }} gap="10px">
              <input
                value={topicQuery}
                onChange={(event) => setTopicQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setTopicPage(1);
                    void refreshTopics();
                  }
                }}
                placeholder="搜索标题、正文、作者..."
                style={{
                  border: "1px solid rgba(15,23,42,0.14)",
                  borderRadius: "14px",
                  height: "42px",
                  padding: "0 12px",
                }}
              />
              <select
                value={topicStatus}
                onChange={(event) => {
                  setTopicPage(1);
                  setTopicStatus(event.target.value);
                }}
                style={{
                  border: "1px solid rgba(15,23,42,0.14)",
                  borderRadius: "14px",
                  height: "42px",
                  padding: "0 12px",
                }}
              >
                <option value="open,awaiting_admin,answered,resolved">Active public</option>
                <option value="awaiting_admin">Awaiting admin</option>
                <option value="answered,resolved">Answered / resolved</option>
                <option value="closed">Closed</option>
                <option value="hidden">Hidden</option>
                <option value="open,awaiting_admin,answered,resolved,closed,hidden,locked">All statuses</option>
              </select>
              <select
                value={topicPinnedFilter}
                onChange={(event) => {
                  setTopicPage(1);
                  setTopicPinnedFilter(event.target.value as "all" | "pinned" | "unpinned");
                }}
                style={{
                  border: "1px solid rgba(15,23,42,0.14)",
                  borderRadius: "14px",
                  height: "42px",
                  padding: "0 12px",
                }}
              >
                <option value="all">All pin states</option>
                <option value="pinned">Pinned only</option>
                <option value="unpinned">Unpinned only</option>
              </select>
            </Grid>

            {topics.length === 0 ? (
              <EmptyBlock title="没有匹配帖子" description="调整筛选条件，或等待用户在公开 Forum 发帖。" />
            ) : (
              <Stack gap="10px">
                {topics.map((topic) => (
                  <Box
                    key={topic.topicId}
                    as="button"
                    textAlign="left"
                    border="1px solid"
                    borderColor={selectedTopic?.topicId === topic.topicId ? "rgba(42,99,235,0.50)" : "rgba(15,23,42,0.10)"}
                    borderRadius="18px"
                    bg={selectedTopic?.topicId === topic.topicId ? "rgba(42,99,235,0.08)" : "rgba(255,255,255,0.82)"}
                    p="14px"
                    onClick={() => setSelectedTopicId(topic.topicId)}
                  >
                    <HStack justifyContent="space-between" alignItems="start" gap="12px">
                      <Box minW="0">
                        <Text fontWeight="800">{topic.title}</Text>
                        <Text color="ink.500" mt="4px">{topic.excerpt}</Text>
                        <Text color="ink.500" mt="8px" fontSize="13px">
                          {topic.category} · {topic.authorDisplay} · {formatDateTime(topic.lastActivityAt)}
                        </Text>
                      </Box>
                      <Stack alignItems="end" gap="6px">
                        <SentinelStatusChip label={topicStatusLabels[topic.status] ?? topic.status} tone={topicTone(topic.status)} />
                        {topic.pinned ? <SentinelStatusChip label="Pinned" tone="green" /> : null}
                      </Stack>
                    </HStack>
                    <HStack mt="10px" gap="8px" flexWrap="wrap" color="ink.500" fontSize="13px">
                      <Text>{topic.repliesCount} replies</Text>
                      <Text>{topic.viewsCount} views</Text>
                      <Text>{topic.officialRepliesCount} official</Text>
                    </HStack>
                  </Box>
                ))}
              </Stack>
            )}

            <HStack justifyContent="space-between">
              <Button variant="outline" disabled={topicPage <= 1 || busy} onClick={() => setTopicPage((page) => Math.max(1, page - 1))}>上一页</Button>
              <Text color="ink.500" fontSize="13px">第 {topicPage} / {topicTotalPages} 页</Text>
              <Button variant="outline" disabled={topicPage >= topicTotalPages || busy} onClick={() => setTopicPage((page) => page + 1)}>下一页</Button>
            </HStack>
          </Stack>
        </SurfaceCard>

        <Stack gap="16px">
          <SurfaceCard
            eyebrow="Topic Detail"
            title={selectedTopic?.title ?? "选择一个帖子"}
            description="关闭不会隐藏帖子，只会锁定继续回复；隐藏是单独 moderation 行为。"
            stamp={selectedTopic?.topicId ?? "no selection"}
          >
            {selectedTopic ? (
              <Stack gap="12px">
                <HStack gap="8px" flexWrap="wrap">
                  <SentinelStatusChip label={topicStatusLabels[selectedTopic.status] ?? selectedTopic.status} tone={topicTone(selectedTopic.status)} />
                  {selectedTopic.pinned ? <SentinelStatusChip label="Pinned" tone="green" /> : null}
                  {selectedTopic.resolved ? <SentinelStatusChip label="Resolved" tone="green" /> : null}
                  {selectedTopic.locked ? <SentinelStatusChip label="Locked" tone="gray" /> : null}
                </HStack>
                <Text color="ink.500">
                  {selectedTopic.authorDisplay} · {selectedTopic.category} · {formatDateTime(selectedTopic.createdAt)}
                </Text>
                <Box borderRadius="16px" bg="rgba(245,247,251,0.92)" p="14px" whiteSpace="pre-wrap">
                  {selectedTopic.body || selectedTopic.excerpt}
                </Box>
                <HStack gap="12px" flexWrap="wrap" color="ink.500" fontSize="13px">
                  <Text>{selectedTopic.viewsCount} views</Text>
                  <Text>{selectedTopic.repliesCount} replies</Text>
                  <Text>{selectedTopic.officialRepliesCount} official replies</Text>
                </HStack>
                {selectedTopic.closedReason ? (
                  <Box borderRadius="16px" bg="rgba(15,23,42,0.06)" p="12px" color="ink.600" fontSize="14px">
                    关闭原因：{selectedTopic.closedReason}
                  </Box>
                ) : null}
              </Stack>
            ) : (
              <EmptyBlock title="没有选中帖子" description="当前筛选没有可管理的帖子。" />
            )}
          </SurfaceCard>

          <SurfaceCard
            eyebrow="Moderation Actions"
            title="状态与置顶"
            description="状态变更会写入 lifecycle timeline，方便后续审计和追踪。"
            stamp="manual only"
          >
            <Stack gap="12px">
              <Textarea
                minH="76px"
                value={closeReason}
                onChange={(event) => setCloseReason(event.target.value)}
                placeholder="关闭原因，关闭帖子时必填。"
              />
              <HStack flexWrap="wrap">
                <Button colorPalette="green" disabled={!selectedTopic || busy} onClick={() => void togglePinnedTopic()}>
                  {selectedTopic?.pinned ? "取消置顶" : "置顶"}
                </Button>
                <Button variant="outline" disabled={!selectedTopic || selectedTopic.status !== "closed" || busy} onClick={() => void reopenTopic()}>
                  重新打开
                </Button>
                <Button colorPalette="red" disabled={!selectedTopic || selectedTopic.status === "closed" || closeReason.trim().length < 3 || busy} onClick={() => void closeTopic()}>
                  关闭帖子
                </Button>
              </HStack>
            </Stack>
          </SurfaceCard>

          <SurfaceCard
            eyebrow="Lifecycle Timeline"
            title="生命周期记录"
            description="谁在什么时候关闭、重开、置顶，都会作为事件留存。"
            stamp={`${topicDetail?.events.length ?? 0} events`}
          >
            {topicDetail?.events.length ? (
              <Stack gap="8px">
                {topicDetail.events.map((event) => (
                  <Box key={event.eventId} border="1px solid rgba(15,23,42,0.10)" borderRadius="14px" p="10px">
                    <Text fontWeight="800">{event.action}</Text>
                    <Text color="ink.500" fontSize="13px">
                      {event.actorAdminId ?? "system"} · {formatDateTime(event.createdAt)} · {event.fromStatus ?? "-"} → {event.toStatus ?? "-"}
                    </Text>
                    {event.reason ? <Text mt="4px" color="ink.500" fontSize="13px">{event.reason}</Text> : null}
                  </Box>
                ))}
              </Stack>
            ) : (
              <EmptyBlock title="暂无生命周期事件" description="关闭、重开、置顶或取消置顶后会出现在这里。" />
            )}
          </SurfaceCard>
        </Stack>
      </Grid>
    </>
  );

  const renderResponseQueue = () => (
    <>
      <Grid templateColumns={{ base: "1fr", md: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label="Queue" value={queueMetrics.total} meta="当前筛选下的回复任务" />
        <MetricCard label="Draft ready" value={queueMetrics.draftReady} meta="Agent 草稿已生成" />
        <MetricCard label="Bug signals" value={queueMetrics.bugs} meta="可能需要进入候选需求池" />
        <MetricCard label="High priority" value={queueMetrics.highRisk} meta="需要优先处理" />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "420px minmax(0, 1fr)" }} gap="18px" alignItems="start">
        <SurfaceCard
          eyebrow={view === "history" ? "Response History" : "Response Queue"}
          title={view === "history" ? "历史任务" : "未回复队列"}
          description="列表只承载处理优先级；点击后在右侧审核 Agent 建议和发送公开回复。"
          stamp={`${tasks.length} tasks`}
        >
          {tasks.length === 0 ? (
            <EmptyBlock title="当前没有待处理帖子" description="新发帖会自动进入 awaiting_response；Growing 推送草稿后会变为 draft_ready。" />
          ) : (
            <Stack gap="10px">
              {tasks.map((item) => (
                <Box
                  key={item.responseTaskId}
                  as="button"
                  textAlign="left"
                  border="1px solid"
                  borderColor={selectedTask?.responseTaskId === item.responseTaskId ? "rgba(42,99,235,0.50)" : "rgba(15,23,42,0.10)"}
                  borderRadius="18px"
                  bg={selectedTask?.responseTaskId === item.responseTaskId ? "rgba(42,99,235,0.08)" : "rgba(255,255,255,0.82)"}
                  p="14px"
                  onClick={() => setSelectedTaskId(item.responseTaskId)}
                >
                  <HStack justifyContent="space-between" alignItems="start">
                    <Box>
                      <Text fontWeight="800">{item.topic?.title ?? item.topicId}</Text>
                      <Text color="ink.500" mt="4px">{item.topic?.category ?? "Forum"} · {item.topic?.authorDisplay ?? "unknown"}</Text>
                    </Box>
                    <SentinelStatusChip label={responseTaskStatusLabels[item.status] ?? item.status} tone={responseTaskTone(item.status)} />
                  </HStack>
                  <HStack mt="10px" gap="8px" flexWrap="wrap">
                    <SentinelStatusChip label={item.priority} tone={priorityTone(item.priority)} />
                    <SentinelStatusChip label={classificationLabels[item.classification ?? ""] ?? item.classification ?? "未分类"} tone="gray" />
                  </HStack>
                </Box>
              ))}
            </Stack>
          )}
        </SurfaceCard>

        <Stack gap="16px">
          <SurfaceCard
            eyebrow="Topic Context"
            title={selectedTask?.topic?.title ?? "选择一个帖子"}
            description="发帖人必须收到反馈；这里展示原帖上下文和是否已生成 Agent 建议。"
            stamp={selectedTask ? selectedTask.responseTaskId : "no selection"}
          >
            {selectedTask ? (
              <Stack gap="12px">
                <HStack gap="8px" flexWrap="wrap">
                  <SentinelStatusChip label={responseTaskStatusLabels[selectedTask.status] ?? selectedTask.status} tone={responseTaskTone(selectedTask.status)} />
                  <SentinelStatusChip label={selectedTask.priority} tone={priorityTone(selectedTask.priority)} />
                  <SentinelStatusChip label={classificationLabels[selectedTask.classification ?? ""] ?? selectedTask.classification ?? "未分类"} tone="gray" />
                </HStack>
                <Text color="ink.500">
                  {selectedTask.topic?.authorDisplay} · {selectedTask.topic?.category} · {formatDateTime(selectedTask.topic?.createdAt ?? null)}
                </Text>
                <Box borderRadius="16px" bg="rgba(245,247,251,0.92)" p="14px" whiteSpace="pre-wrap">
                  {selectedTask.topic?.body}
                </Box>
                <HStack gap="10px" flexWrap="wrap">
                  {growingLinks.length === 0 ? (
                    <Text color="ink.500" fontSize="13px">暂无 Growing Candidate / Requirement / Workflow 链接。</Text>
                  ) : null}
                  {growingLinks.map((link) => (
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
              </Stack>
            ) : (
              <EmptyBlock title="没有选中帖子" description="队列为空，或者当前筛选条件下没有未回复记录。" />
            )}
          </SurfaceCard>

          <SurfaceCard
            eyebrow="Human Reviewed Reply"
            title={isHistoryMode ? "历史记录" : "审核并发送"}
            description={isHistoryMode ? "历史任务只读，避免重复公开回复；如需追溯请查看原帖和审计记录。" : "Agent 草稿只是建议。管理员可编辑后以 Synapse Ops 身份回复；发送后帖子会进入 answered。"}
            stamp={selectedTask?.suggestedReplySource === "growing" ? "agent draft" : "manual"}
          >
            <Stack gap="12px">
              <Textarea
                minH="180px"
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
                readOnly={!selectedTaskActionable}
                placeholder={isHistoryMode ? "历史任务不可编辑。" : "这里会显示 Agent 建议回复；没有建议时也可以直接手写回复。"}
              />
              <HStack justifyContent="space-between" alignItems="start" gap="12px" flexWrap="wrap">
                <Box flex="1" minW="260px">
                  <Textarea
                    minH="70px"
                    value={ignoreReason}
                    onChange={(event) => setIgnoreReason(event.target.value)}
                    readOnly={!selectedTaskActionable}
                    placeholder="忽略原因，选择忽略时必填。"
                  />
                </Box>
                <HStack>
                  <Button colorPalette="green" onClick={() => void sendReply()} disabled={!canSendForumReply(selectedTask, replyBody, busy)}>
                    发送回复
                  </Button>
                  <Button variant="outline" onClick={() => void ignoreTask()} disabled={!canIgnoreForumTask(selectedTask, ignoreReason, busy)}>
                    忽略
                  </Button>
                </HStack>
              </HStack>
              <Text color="ink.500" fontSize="13px">
                高风险、资金、auth、生产类问题不要在公开回复中承诺根因或赔付；先给出已收到、需要补充信息或会转人工处理的安全表述。
              </Text>
            </Stack>
          </SurfaceCard>
        </Stack>
      </Grid>
    </>
  );

  return (
    <AdminShell
      admin={admin}
      eyebrow="Community Support"
      title="Forum Support Operations"
      description="所有帖子生命周期和未回复队列在这里收口；Agent 只给建议，最终公开回复和关闭动作必须由管理员确认。"
      actions={(
        <HStack>
          <Button variant={view === "topics" ? "solid" : "outline"} onClick={() => setView("topics")}>All Topics</Button>
          <Button variant={view === "queue" ? "solid" : "outline"} onClick={() => setView("queue")}>Response Queue</Button>
          <Button variant={view === "history" ? "solid" : "outline"} onClick={() => setView("history")}>History</Button>
          <Button onClick={() => (view === "topics" ? void refreshTopics() : void refreshTasks())} disabled={busy}>刷新</Button>
        </HStack>
      )}
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      {notice ? <MessageBanner kind="success" message={notice} /> : null}
      {view === "topics" ? renderTopicWorkbench() : renderResponseQueue()}
    </AdminShell>
  );
}
