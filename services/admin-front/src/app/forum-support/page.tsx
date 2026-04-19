"use client";

import { Box, Button, Grid, HStack, Link as ChakraLink, Stack, Text, Textarea } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { EmptyBlock, MessageBanner, MetricCard, SentinelStatusChip, SurfaceCard } from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  ignoreForumResponseTask,
  listForumResponseTasks,
  sendForumResponseReply,
  type ForumResponseTask,
} from "@/services/admin-api";

const statusLabels: Record<string, string> = {
  awaiting_response: "等待回复",
  draft_ready: "草稿就绪",
  responded: "已回复",
  ignored: "已忽略",
  closed: "已关闭",
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
  if (priority === "critical" || priority === "high") {
    return "red";
  }
  if (priority === "normal") {
    return "orange";
  }
  return "gray";
}

function statusTone(status: string): "green" | "orange" | "red" | "gray" {
  if (status === "draft_ready") {
    return "green";
  }
  if (status === "awaiting_response") {
    return "orange";
  }
  if (status === "ignored") {
    return "gray";
  }
  return "green";
}

export default function ForumSupportPage() {
  const { admin, token, loading } = useAdminSession();
  const [items, setItems] = useState<ForumResponseTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [ignoreReason, setIgnoreReason] = useState("");
  const [status, setStatus] = useState("awaiting_response,draft_ready");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => items.find((item) => item.responseTaskId === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  );

  const metrics = useMemo(() => ({
    total: items.length,
    draftReady: items.filter((item) => item.status === "draft_ready").length,
    bugs: items.filter((item) => item.classification === "bug").length,
    highRisk: items.filter((item) => item.priority === "high" || item.priority === "critical").length,
  }), [items]);

  const refresh = useCallback(async (activeToken = token) => {
    if (!activeToken) {
      return;
    }
    try {
      const response = await listForumResponseTasks(activeToken, { status, pageSize: 50 });
      setItems(response.items);
      setSelectedId((current) => {
        if (response.items.length === 0) {
          return null;
        }
        if (response.items.some((item) => item.responseTaskId === current)) {
          return current;
        }
        return response.items[0].responseTaskId;
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载社区回复队列失败");
    }
  }, [status, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void refresh(token);
  }, [token, refresh]);

  useEffect(() => {
    setReplyBody(selected?.suggestedReply ?? "");
    setIgnoreReason("");
  }, [selected?.responseTaskId, selected?.suggestedReply]);

  if (loading || !admin) {
    return <ControlPlaneLoadingScreen title="Forum Support" message="正在加载社区回复工作台..." />;
  }

  async function sendReply() {
    if (!token || !selected) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await sendForumResponseReply(token, selected.responseTaskId, {
        body: replyBody,
        authorDisplay: "Synapse Ops",
        authorAddress: "synapse:ops",
      });
      setNotice("回复已发送，帖子已从未回复队列移除。");
      await refresh(token);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "发送回复失败");
    } finally {
      setBusy(false);
    }
  }

  async function ignoreTask() {
    if (!token || !selected) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await ignoreForumResponseTask(token, selected.responseTaskId, { reason: ignoreReason });
      setNotice("已忽略该帖子，未回复状态已消除。");
      await refresh(token);
    } catch (ignoreError) {
      setError(ignoreError instanceof Error ? ignoreError.message : "忽略帖子失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Community Support"
      title="社区回复"
      description="未回复帖子进入后台队列；Agent 只给建议，最终回复必须由管理员审核发送。"
      actions={(
        <HStack>
          <Button variant={status.includes("responded") ? "solid" : "outline"} onClick={() => setStatus("awaiting_response,draft_ready")}>待回复</Button>
          <Button variant={status.includes("responded") ? "outline" : "ghost"} onClick={() => setStatus("responded,ignored,closed")}>历史</Button>
          <Button onClick={() => void refresh()} disabled={busy}>刷新</Button>
        </HStack>
      )}
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      {notice ? <MessageBanner kind="success" message={notice} /> : null}

      <Grid templateColumns={{ base: "1fr", md: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label="Queue" value={metrics.total} meta="当前筛选下的帖子数" />
        <MetricCard label="Draft ready" value={metrics.draftReady} meta="Agent 草稿已生成" />
        <MetricCard label="Bug signals" value={metrics.bugs} meta="可能需要进入候选需求池" />
        <MetricCard label="High priority" value={metrics.highRisk} meta="需要优先处理" />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "420px minmax(0, 1fr)" }} gap="18px" alignItems="start">
        <SurfaceCard
          eyebrow="Unreplied Queue"
          title="未回复帖子"
          description="列表只承载处理优先级；点击后在右侧审核 Agent 建议和发送回复。"
          stamp={`${items.length} tasks`}
        >
          {items.length === 0 ? (
            <EmptyBlock title="当前没有待处理帖子" description="新发帖会自动进入 awaiting_response；Growing 推送草稿后会变为 draft_ready。" />
          ) : (
            <Stack gap="10px">
              {items.map((item) => (
                <Box
                  key={item.responseTaskId}
                  as="button"
                  textAlign="left"
                  border="1px solid"
                  borderColor={selected?.responseTaskId === item.responseTaskId ? "rgba(42,99,235,0.50)" : "rgba(15,23,42,0.10)"}
                  borderRadius="18px"
                  bg={selected?.responseTaskId === item.responseTaskId ? "rgba(42,99,235,0.08)" : "rgba(255,255,255,0.82)"}
                  p="14px"
                  onClick={() => setSelectedId(item.responseTaskId)}
                >
                  <HStack justifyContent="space-between" alignItems="start">
                    <Box>
                      <Text fontWeight="800">{item.topic?.title ?? item.topicId}</Text>
                      <Text color="ink.500" mt="4px">{item.topic?.category ?? "Forum"} · {item.topic?.authorDisplay ?? "unknown"}</Text>
                    </Box>
                    <SentinelStatusChip label={statusLabels[item.status] ?? item.status} tone={statusTone(item.status)} />
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
            title={selected?.topic?.title ?? "选择一个帖子"}
            description="发帖人必须收到反馈；这里展示原帖上下文和是否已生成 Agent 建议。"
            stamp={selected ? selected.responseTaskId : "no selection"}
          >
            {selected ? (
              <Stack gap="12px">
                <HStack gap="8px" flexWrap="wrap">
                  <SentinelStatusChip label={statusLabels[selected.status] ?? selected.status} tone={statusTone(selected.status)} />
                  <SentinelStatusChip label={selected.priority} tone={priorityTone(selected.priority)} />
                  <SentinelStatusChip label={classificationLabels[selected.classification ?? ""] ?? selected.classification ?? "未分类"} tone="gray" />
                </HStack>
                <Text color="ink.500">
                  {selected.topic?.authorDisplay} · {selected.topic?.category} · {formatDateTime(selected.topic?.createdAt ?? null)}
                </Text>
                <Box borderRadius="16px" bg="rgba(245,247,251,0.92)" p="14px" whiteSpace="pre-wrap">
                  {selected.topic?.body}
                </Box>
                <HStack gap="10px" flexWrap="wrap">
                  {selected.linkedRequirementCandidateId ? (
                    <ChakraLink
                      href={`http://localhost:9700/planning?candidate=${selected.linkedRequirementCandidateId}`}
                      target="_blank"
                      rel="noreferrer"
                      border="1px solid rgba(15,23,42,0.14)"
                      borderRadius="999px"
                      px="12px"
                      py="7px"
                      fontWeight="700"
                      _hover={{ textDecoration: "none", bg: "rgba(42,99,235,0.08)" }}
                    >
                      打开 Growing Candidate
                    </ChakraLink>
                  ) : null}
                  {selected.linkedRequirementId ? (
                    <ChakraLink
                      href={`http://localhost:9700/requirements/${selected.linkedRequirementId}`}
                      target="_blank"
                      rel="noreferrer"
                      border="1px solid rgba(15,23,42,0.14)"
                      borderRadius="999px"
                      px="12px"
                      py="7px"
                      fontWeight="700"
                      _hover={{ textDecoration: "none", bg: "rgba(42,99,235,0.08)" }}
                    >
                      打开 Requirement
                    </ChakraLink>
                  ) : null}
                  {selected.linkedWorkflowRunId ? (
                    <ChakraLink
                      href={`http://localhost:9700/workflows/${selected.linkedWorkflowRunId}`}
                      target="_blank"
                      rel="noreferrer"
                      border="1px solid rgba(15,23,42,0.14)"
                      borderRadius="999px"
                      px="12px"
                      py="7px"
                      fontWeight="700"
                      _hover={{ textDecoration: "none", bg: "rgba(42,99,235,0.08)" }}
                    >
                      打开 Workflow
                    </ChakraLink>
                  ) : null}
                </HStack>
              </Stack>
            ) : (
              <EmptyBlock title="没有选中帖子" description="队列为空，或者当前筛选条件下没有未回复记录。" />
            )}
          </SurfaceCard>

          <SurfaceCard
            eyebrow="Human Reviewed Reply"
            title="审核并发送"
            description="Agent 草稿只是建议。管理员可编辑后以 Synapse Ops 身份回复；发送后未回复状态会立即消除。"
            stamp={selected?.suggestedReplySource === "growing" ? "agent draft" : "manual"}
          >
            <Stack gap="12px">
              <Textarea
                minH="180px"
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
                placeholder="这里会显示 Agent 建议回复；没有建议时也可以直接手写回复。"
              />
              <HStack justifyContent="space-between" alignItems="start" gap="12px" flexWrap="wrap">
                <Box flex="1" minW="260px">
                  <Textarea
                    minH="70px"
                    value={ignoreReason}
                    onChange={(event) => setIgnoreReason(event.target.value)}
                    placeholder="忽略原因，选择忽略时必填。"
                  />
                </Box>
                <HStack>
                  <Button colorPalette="green" onClick={() => void sendReply()} disabled={!selected || replyBody.trim().length < 2 || busy}>
                    发送回复
                  </Button>
                  <Button variant="outline" onClick={() => void ignoreTask()} disabled={!selected || ignoreReason.trim().length < 3 || busy}>
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
    </AdminShell>
  );
}
