"use client";

import { Box, Button, Grid, Heading, Input, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { DataTable, EmptyBlock, MessageBanner, MetricCard, OverlayPanel, SearchInput, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th, nativeFieldStyle } from "@/components/console-ui";
import { formatDateTime, formatUsdc, inputText } from "@/lib/admin-console";
import { useAdminSession } from "@/lib/use-admin-session";
import { listProviderWithdrawReviewHistory, type ProviderWithdrawReviewHistoryItem } from "@/services/admin-api";
import { buildReviewHistoryFlow, buildReviewHistoryMetrics, collectReviewHistoryReviewers, collectReviewHistoryStatuses, getReviewDecisionLabel, getReviewDecisionTone, getReviewHistoryStatusLabel, getReviewHistoryStatusTone } from "@/features/review-history/review-history-presenters";

type ReviewHistoryFilters = {
  query: string;
  reviewer: string;
  currentStatus: string;
  reviewDecision: string;
  reviewedFrom: string;
  reviewedTo: string;
};

const DEFAULT_FILTERS: ReviewHistoryFilters = {
  query: "",
  reviewer: "",
  currentStatus: "all",
  reviewDecision: "all",
  reviewedFrom: "",
  reviewedTo: "",
};

function normalizeFilterValue(value: string): string | undefined {
  return value === "all" || value === "" ? undefined : value;
}

function getFlowDotBackground(tone: "green" | "orange" | "red" | "gray"): string {
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

export default function ReviewHistoryPage() {
  const { admin, token, loading } = useAdminSession();
  const [items, setItems] = useState<ProviderWithdrawReviewHistoryItem[]>([]);
  const [draftFilters, setDraftFilters] = useState<ReviewHistoryFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<ReviewHistoryFilters>(DEFAULT_FILTERS);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [activeWithdrawalId, setActiveWithdrawalId] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const metrics = useMemo(() => buildReviewHistoryMetrics(items), [items]);
  const statuses = useMemo(() => collectReviewHistoryStatuses(items), [items]);
  const reviewers = useMemo(() => collectReviewHistoryReviewers(items), [items]);
  const activeItem = useMemo(
    () => items.find((item) => item.withdrawalId === activeWithdrawalId) ?? null,
    [activeWithdrawalId, items],
  );
  const activeFlow = useMemo(() => (activeItem ? buildReviewHistoryFlow(activeItem) : []), [activeItem]);
  const pageNumber = cursorHistory.length + 1;

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;

    async function load() {
      try {
        setIsFetching(true);
        const response = await listProviderWithdrawReviewHistory(activeToken, {
          limit: pageSize,
          cursor: cursor ?? undefined,
          query: appliedFilters.query || undefined,
          reviewer: appliedFilters.reviewer || undefined,
          currentStatus: normalizeFilterValue(appliedFilters.currentStatus),
          reviewDecision: normalizeFilterValue(appliedFilters.reviewDecision),
          reviewedFrom: appliedFilters.reviewedFrom || undefined,
          reviewedTo: appliedFilters.reviewedTo || undefined,
        });
        if (!cancelled) {
          setItems(response.items);
          setNextCursor(response.nextCursor);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载审核历史失败");
        }
      } finally {
        if (!cancelled) {
          setIsFetching(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [appliedFilters, cursor, pageSize, token]);

  useEffect(() => {
    if (activeWithdrawalId && !items.some((item) => item.withdrawalId === activeWithdrawalId)) {
      setIsDetailOpen(false);
      setActiveWithdrawalId(null);
    }
  }, [activeWithdrawalId, items]);

  function updateDraftFilter<Key extends keyof ReviewHistoryFilters>(key: Key, value: ReviewHistoryFilters[Key]) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function applySearch() {
    setCursor(null);
    setCursorHistory([]);
    setAppliedFilters(draftFilters);
  }

  function goToNextPage() {
    if (!nextCursor) {
      return;
    }
    setCursorHistory((current) => [...current, cursor ?? ""]);
    setCursor(nextCursor);
  }

  function goToPreviousPage() {
    if (cursorHistory.length === 0) {
      return;
    }
    const previousHistory = cursorHistory.slice(0, -1);
    const previousCursor = cursorHistory.at(-1) ?? null;
    setCursorHistory(previousHistory);
    setCursor(previousCursor || null);
  }

  if (loading || !admin) {
    return <ControlPlaneLoadingScreen title="Review History Replay" message="正在回放审核历史..." />;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="业务回溯"
      title="审核历史"
      description="回看提现审核已经做出的处理结论，并确认这些单子当前是已放行、已完成、已拒绝，还是已经释放回余额。"
      actions={<Link href="/withdrawal-reviews"><Button size="sm" borderRadius="full">返回提现审核</Button></Link>}
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}

      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label="审核记录" value={metrics.total} meta="已完成 reviewer 决策的提现单" />
        <MetricCard label="放行记录" value={metrics.approved} meta={`${metrics.completed} 笔已继续走到完成`} />
        <MetricCard label="驳回记录" value={metrics.rejected} meta="被 reviewer 明确拒绝" accent="linear-gradient(180deg, rgba(255,243,240,0.98) 0%, rgba(255,232,226,0.96) 100%)" />
        <MetricCard label="已释放" value={metrics.cancelled} meta="已从锁定态释放回可用余额" />
      </Grid>

      <SurfaceCard eyebrow="Review Ledger" title="审核结果台账" description="给业务同学一个直接可读的审核历史面板，不必切到审计页再手动拼状态。" stamp={`第 ${pageNumber} 页`}>
        <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "minmax(0, 1.8fr) minmax(0, 1.2fr) repeat(4, minmax(0, 0.9fr))" }} gap="12px" mb="12px">
          <SearchInput value={draftFilters.query} onChange={(value) => updateDraftFilter("query", value)} placeholder="搜索提现单 / 用户地址 / requestId / reviewer" />
          <Input value={draftFilters.reviewer} onChange={(event) => updateDraftFilter("reviewer", event.target.value)} placeholder="reviewer 邮箱或角色" bg="rgba(255,255,255,0.85)" borderRadius="16px" borderColor="rgba(99,92,82,0.16)" _focusVisible={{ borderColor: "brand.400", boxShadow: "0 0 0 3px rgba(243,106,29,0.16)" }} list="review-history-reviewers" />
          <datalist id="review-history-reviewers">
            {reviewers.map((reviewer) => <option key={reviewer} value={reviewer} />)}
          </datalist>
          <select value={draftFilters.currentStatus} onChange={(event) => updateDraftFilter("currentStatus", event.target.value)} style={nativeFieldStyle}>
            <option value="all">全部当前状态</option>
            {statuses.map((status) => <option key={status} value={status}>{getReviewHistoryStatusLabel(status)}</option>)}
          </select>
          <select value={draftFilters.reviewDecision} onChange={(event) => updateDraftFilter("reviewDecision", event.target.value)} style={nativeFieldStyle}>
            <option value="all">全部处理结论</option>
            <option value="APPROVE">放行</option>
            <option value="REJECT">驳回</option>
          </select>
          <input type="date" value={draftFilters.reviewedFrom} onChange={(event) => updateDraftFilter("reviewedFrom", event.target.value)} style={nativeFieldStyle} />
          <input type="date" value={draftFilters.reviewedTo} onChange={(event) => updateDraftFilter("reviewedTo", event.target.value)} style={nativeFieldStyle} />
        </Grid>

        <Grid templateColumns={{ base: "1fr", md: "180px 180px auto" }} gap="12px" mb="16px">
          <select value={String(pageSize)} onChange={(event) => {
            const nextPageSize = Number(event.target.value);
            setPageSize(nextPageSize);
            setCursor(null);
            setCursorHistory([]);
          }} style={nativeFieldStyle}>
            <option value="10">每页 10 条</option>
            <option value="20">每页 20 条</option>
            <option value="50">每页 50 条</option>
          </select>
          <Button size="md" borderRadius="16px" onClick={applySearch} loading={isFetching} alignSelf="stretch">
            搜索
          </Button>
          <Stack direction="row" justify={{ base: "flex-start", md: "flex-end" }} gap="10px">
            <Button variant="ghost" borderRadius="16px" onClick={goToPreviousPage} disabled={cursorHistory.length === 0 || isFetching}>
              上一页
            </Button>
            <Button variant="ghost" borderRadius="16px" onClick={goToNextPage} disabled={!nextCursor || isFetching}>
              下一页
            </Button>
          </Stack>
        </Grid>

        {items.length === 0 ? (
          <EmptyBlock title="当前没有匹配的审核历史" description="调整筛选条件后，这里会展示已处理提现的状态回放。" />
        ) : (
          <DataTable>
            <TableHeaderRow>
              <Th>提现单</Th>
              <Th>提现用户</Th>
              <Th>提现金额</Th>
              <Th>处理结论</Th>
              <Th>当前状态</Th>
              <Th>处理人</Th>
              <Th>备注</Th>
              <Th>处理时间</Th>
              <Th>详情</Th>
            </TableHeaderRow>
            <TableBody>
              {items.map((item) => (
                <Box as="tr" key={item.withdrawalId}>
                  <Td>
                    <Text fontWeight="700">{item.withdrawalId}</Text>
                  </Td>
                  <Td>
                    <Text>{inputText(item.ownerAddress)}</Text>
                  </Td>
                  <Td>
                    <Text fontWeight="700">{formatUsdc(item.amountUsdc ?? "0")}</Text>
                  </Td>
                  <Td>
                    <SentinelStatusChip label={getReviewDecisionLabel(item.reviewDecision)} tone={getReviewDecisionTone(item.reviewDecision)} />
                  </Td>
                  <Td>
                    <SentinelStatusChip label={getReviewHistoryStatusLabel(item.currentStatus)} tone={getReviewHistoryStatusTone(item.currentStatus)} />
                  </Td>
                  <Td>
                    <Text>{inputText(item.reviewerEmail)}</Text>
                  </Td>
                  <Td>
                    <Text>{inputText(item.reviewerNote ?? item.message)}</Text>
                  </Td>
                  <Td>{formatDateTime(item.reviewedAt)}</Td>
                  <Td>
                    <Button
                      size="sm"
                      borderRadius="full"
                      variant="ghost"
                      onClick={() => {
                        setActiveWithdrawalId(item.withdrawalId);
                        setIsDetailOpen(true);
                      }}
                    >
                      详情
                    </Button>
                  </Td>
                </Box>
              ))}
            </TableBody>
          </DataTable>
        )}
      </SurfaceCard>

      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <SurfaceCard eyebrow="How To Use" title="什么时候看这里" description="审核台处理当下，历史页负责回放结果，不把两种任务混在一个工作台里。">
          <Stack gap="12px">
            {[
              "业务想确认某笔提现是否已经被放行或驳回。",
              "财务需要区分‘已放行但未链上完成’和‘已取消 / 已释放’。",
              "reviewer 想快速回看最近自己或同组同学的判断备注。",
            ].map((line) => (
              <Box key={line} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Text>{line}</Text>
              </Box>
            ))}
          </Stack>
        </SurfaceCard>

        <SurfaceCard eyebrow="State Handoff" title="状态交接说明" description="让业务看懂审核动作和提现生命周期之间的关系。">
          <Stack gap="12px">
            {[
              "放行后先进入“已放行”，链上真正完成后再进入“已完成”。",
              "驳回会直接停在“已拒绝”，不再继续出票。",
              "如果票据过期回滚或系统释放锁定金额，会显示“已取消 / 已释放”。",
            ].map((line) => (
              <Box key={line} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Text color="ink.500">{line}</Text>
              </Box>
            ))}
          </Stack>
        </SurfaceCard>
      </Grid>

      <OverlayPanel
        open={isDetailOpen && activeItem !== null}
        title={activeItem?.withdrawalId ?? "审核详情"}
        description="下钻查看这笔提现的完整 evidence、风险标签和状态流转。"
        onClose={() => setIsDetailOpen(false)}
      >
        {activeItem ? (
          <Stack gap="14px">
            <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
              <Stack direction="row" justify="space-between" align="center">
                <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Evidence Summary</Text>
                <Stack direction="row" gap="8px">
                  <SentinelStatusChip label={getReviewDecisionLabel(activeItem.reviewDecision)} tone={getReviewDecisionTone(activeItem.reviewDecision)} />
                  <SentinelStatusChip label={getReviewHistoryStatusLabel(activeItem.currentStatus)} tone={getReviewHistoryStatusTone(activeItem.currentStatus)} />
                </Stack>
              </Stack>
              <Heading mt="10px" size="sm">{inputText(activeItem.evidenceSummary ?? activeItem.message)}</Heading>
              <Text mt="8px" color="ink.500">风险等级 {inputText(activeItem.riskLevel)} · 原因标签 {inputText(activeItem.riskReasonCode)}</Text>
            </Box>

            <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="10px">
              {[
                ["用户地址", activeItem.ownerAddress],
                ["提现金额", `${formatUsdc(activeItem.amountUsdc ?? "0")} USDC`],
                ["申请编号", inputText(activeItem.requestId)],
                ["交易哈希", inputText(activeItem.txHash)],
                ["处理人", inputText(activeItem.reviewerEmail)],
                ["处理角色", inputText(activeItem.reviewerRole)],
              ].map(([label, value]) => (
                <Box key={label} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                  <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{label}</Text>
                  <Heading mt="10px" size="sm">{value}</Heading>
                </Box>
              ))}
            </Grid>

            <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
              <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">处理备注</Text>
              <Text mt="10px">{inputText(activeItem.reviewerNote)}</Text>
              <Text mt="8px" color="ink.500">系统说明：{inputText(activeItem.message)}</Text>
            </Box>

            <SurfaceCard eyebrow="Status Replay" title="状态流转" description="把申请进入人工审核、reviewer 决策和当前提现状态串成一条业务时间线。">
              <Stack gap="12px">
                {activeFlow.map((step, index) => (
                  <Box key={step.key} position="relative" pl="28px">
                    {index < activeFlow.length - 1 ? (
                      <Box position="absolute" left="9px" top="22px" bottom="-18px" w="2px" bg="rgba(99,92,82,0.14)" />
                    ) : null}
                    <Box position="absolute" left="0" top="7px" w="20px" h="20px" borderRadius="full" bg={getFlowDotBackground(step.tone)} border="1px solid rgba(99,92,82,0.12)" />
                    <Box borderRadius="18px" p="14px 16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                      <Stack direction={{ base: "column", md: "row" }} justify="space-between" align={{ base: "flex-start", md: "center" }} gap="8px">
                        <Heading size="sm">{step.label}</Heading>
                        <SentinelStatusChip label={step.timestamp ? formatDateTime(step.timestamp) : "等待时间戳"} tone={step.tone} />
                      </Stack>
                      <Text mt="8px" color="ink.500">{step.detail}</Text>
                    </Box>
                  </Box>
                ))}
              </Stack>
            </SurfaceCard>
          </Stack>
        ) : null}
      </OverlayPanel>
    </AdminShell>
  );
}