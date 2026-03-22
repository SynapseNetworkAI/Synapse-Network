"use client";

import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { DataTable, EmptyBlock, MessageBanner, MetricCard, SearchInput, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th, nativeFieldStyle, nativeTextAreaStyle } from "@/components/console-ui";
import { buildWithdrawReasonClusters, buildWithdrawReviewMetrics, filterWithdrawReviews, getWithdrawRiskTone, listWithdrawRiskLevels, sortWithdrawReviewsByPriority } from "@/features/withdrawal-reviews/review-presenters";
import { formatDateTime, formatUsdc, inputText, toneFromStatus } from "@/lib/admin-console";
import { useProviderWithdrawReviews } from "@/features/withdrawal-reviews/use-provider-withdraw-reviews";
import { useAdminStepUp } from "@/lib/use-admin-step-up";
import { useAdminSession } from "@/lib/use-admin-session";


export default function WithdrawalReviewsPage() {
  const { admin, security, token, loading } = useAdminSession();
  const { requestStepUpCode, stepUpModal } = useAdminStepUp({
    enabled: security?.highRiskTotpRequired ?? false,
    issuer: security?.totpIssuer ?? "Synapse Gateway Admin",
  });
  const {
    items,
    activeReviewId,
    decisionNote,
    message,
    error,
    isPending,
    setActiveReviewId,
    setDecisionNote,
    setMessage,
    handleDecision,
  } = useProviderWithdrawReviews(token, requestStepUpCode);
  const canDecide = admin?.permissions.includes("approval:decide") ?? false;
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const deferredSearch = useDeferredValue(search);

  const metrics = useMemo(() => buildWithdrawReviewMetrics(items), [items]);
  const riskLevels = useMemo(() => listWithdrawRiskLevels(items), [items]);
  const reasonClusters = useMemo(() => buildWithdrawReasonClusters(items).slice(0, 4), [items]);
  const visibleItems = useMemo(
    () => sortWithdrawReviewsByPriority(filterWithdrawReviews(items, deferredSearch, riskFilter)),
    [deferredSearch, items, riskFilter],
  );

  useEffect(() => {
    if (globalThis.window === undefined) {
      return;
    }

    const params = new URLSearchParams(globalThis.window.location.search);
    setSearch(params.get("q") ?? "");
    setRiskFilter(params.get("risk") ?? "all");
  }, []);

  useEffect(() => {
    const nextActiveId = visibleItems.some((item) => item.withdrawalId === activeReviewId)
      ? activeReviewId
      : visibleItems[0]?.withdrawalId ?? null;
    if (nextActiveId !== activeReviewId) {
      setActiveReviewId(nextActiveId);
      setDecisionNote("");
    }
  }, [activeReviewId, setActiveReviewId, setDecisionNote, visibleItems]);

  const activeReview = visibleItems.find((item) => item.withdrawalId === activeReviewId) ?? null;

  if (loading || !admin) {
    return <ControlPlaneLoadingScreen title="提现处理同步中" message="正在加载待处理的提现申请..." />;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="提现处理"
      title="提现审核工作台"
      description="集中查看需要人工确认的提现申请，帮助业务、财务和风控同学更快判断该放行、驳回，还是继续跟进。"
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      {message ? <MessageBanner kind="success" message={message} /> : null}

      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label="待处理申请" value={metrics.pendingCount} meta="当前等待人工确认的提现笔数" />
        <MetricCard label="待确认金额" value={formatUsdc(metrics.totalAmount)} meta="当前列表涉及的提现总额" />
        <MetricCard label="优先处理" value={metrics.redCount} meta="建议先处理的高关注申请" />
        <MetricCard label="已关联流水" value={metrics.linkedCount} meta={`另有 ${metrics.yellowCount} 笔需要持续关注`} />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1.05fr 0.95fr" }} gap="16px">
        <SurfaceCard eyebrow="待处理列表" title="提现审核队列" description="这里汇总所有需要人工确认的提现申请，方便按用户、申请编号和风险等级快速筛查。" stamp={canDecide ? "可查看并处理" : "仅可查看"}>
          <Grid templateColumns={{ base: "1fr", xl: "minmax(0, 320px) 180px" }} gap="12px" mb="16px">
            <SearchInput value={search} onChange={setSearch} placeholder="搜索申请编号、用户地址或原因标签" />
            <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)} style={nativeFieldStyle}>
              <option value="all">全部风险等级</option>
              {riskLevels.map((level) => <option key={level} value={level}>{level.toUpperCase()}</option>)}
            </select>
          </Grid>
          {visibleItems.length ? (
            <DataTable>
              <TableHeaderRow>
                <Th>Withdrawal</Th>
                <Th>Owner</Th>
                <Th>Amount</Th>
                <Th>Risk</Th>
                <Th>Status</Th>
              </TableHeaderRow>
              <TableBody>
                {visibleItems.map((item) => (
                  <Box as="tr" key={item.withdrawalId} onClick={() => { setActiveReviewId(item.withdrawalId); setDecisionNote(""); setMessage(null); }} style={{ cursor: "pointer" }}>
                    <Td>
                      <Text fontWeight="700">{item.withdrawalId}</Text>
                      <Text color="ink.500">{formatDateTime(item.createdAt)}</Text>
                    </Td>
                    <Td>
                      <Text>{item.ownerAddress}</Text>
                      <Text color="ink.500">{inputText(item.requestId)}</Text>
                    </Td>
                    <Td>{formatUsdc(item.amountUsdc)}</Td>
                    <Td><SentinelStatusChip label={(item.riskLevel ?? "unknown").toUpperCase()} tone={getWithdrawRiskTone(item.riskLevel)} /></Td>
                    <Td><SentinelStatusChip label={item.status} tone={toneFromStatus(item.status)} /></Td>
                  </Box>
                ))}
              </TableBody>
            </DataTable>
          ) : (
            <EmptyBlock title="当前筛选条件下没有待处理申请" description="可以调整风险等级或搜索条件，查看其他需要人工确认的提现。" />
          )}
        </SurfaceCard>

        <SurfaceCard eyebrow="申请详情" title={activeReview?.withdrawalId ?? "请选择一笔申请"} description="查看这笔提现的关键信息、处理依据和备注，避免在来回切页时遗漏判断依据。">
          {activeReview ? (
            <Stack gap="14px">
              <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Stack direction="row" justify="space-between" align="center">
                  <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">处理摘要</Text>
                  <SentinelStatusChip label={(activeReview.riskLevel ?? "unknown").toUpperCase()} tone={getWithdrawRiskTone(activeReview.riskLevel)} />
                </Stack>
                <Heading mt="10px" size="sm">{inputText(activeReview.evidenceSummary ?? activeReview.message)}</Heading>
                <Text mt="8px" color="ink.500">原因标签 {inputText(activeReview.riskReasonCode)} · 流水号 {inputText(activeReview.txHash)}</Text>
              </Box>
              <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="10px">
                {[
                  ["用户地址", activeReview.ownerAddress],
                  ["提现金额", `${formatUsdc(activeReview.amountUsdc)} USDC`],
                  ["申请时间", formatDateTime(activeReview.createdAt)],
                  ["申请编号", inputText(activeReview.requestId)],
                ].map(([label, value]) => (
                  <Box key={label} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                    <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{label}</Text>
                    <Heading mt="10px" size="sm">{value}</Heading>
                  </Box>
                ))}
              </Grid>
              <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">处理备注</Text>
                <Box mt="10px">
                  <textarea
                    value={decisionNote}
                    onChange={(event) => setDecisionNote(event.target.value)}
                    placeholder="填写核实结果、处理原因，或需要其他同事继续跟进的说明。"
                    style={nativeTextAreaStyle}
                  />
                </Box>
              </Box>
              <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="10px">
                <Button bg="signal.500" color="white" borderRadius="18px" h="52px" onClick={() => handleDecision("APPROVE")} disabled={!canDecide || isPending || !activeReview}>确认放行</Button>
                <Button bg="#b83131" color="white" borderRadius="18px" h="52px" onClick={() => handleDecision("REJECT")} disabled={!canDecide || isPending || !activeReview}>驳回申请</Button>
              </Grid>
              {canDecide ? null : <MessageBanner kind="error" message="当前账号只有查看权限，不能提交处理结果。" />}
            </Stack>
          ) : (
            <EmptyBlock title="还没有选中申请" description="从左侧列表选择一笔提现申请，即可查看详情并填写处理意见。" />
          )}
        </SurfaceCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "0.92fr 1.08fr" }} gap="16px">
        <SurfaceCard eyebrow="原因分布" title="常见触发原因" description="先看哪些原因最集中，再决定是逐笔处理，还是统一排查某一类问题。">
          <Stack gap="12px">
            {reasonClusters.map((cluster) => (
              <Box key={cluster.code} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Stack direction="row" justify="space-between" align="center">
                  <Heading size="sm">{cluster.code}</Heading>
                  <SentinelStatusChip label={`${cluster.count} 笔`} tone={cluster.code === "manual_review" ? "gray" : "orange"} />
                </Stack>
              </Box>
            ))}
          </Stack>
        </SurfaceCard>

        <SurfaceCard eyebrow="处理说明" title="操作注意事项" description="提交结果前，请确认判断依据和备注完整，方便后续追踪、复核和对外沟通。">
          <Stack gap="12px">
            {[
              ["处理结果", "放行后，申请会进入后续出款流程；驳回后，会回到可用状态并保留处理记录。"],
              ["备注要求", "无论通过还是驳回，都建议写清楚核实结果和处理原因，方便后续查询与复盘。"],
              ["页面定位", "这里专门处理需要人工确认的提现申请，避免和其他审批事项混在一起，影响判断效率。"],
            ].map(([title, description]) => (
              <Box key={title} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Heading size="sm">{title}</Heading>
                <Text mt="8px" color="ink.500">{description}</Text>
              </Box>
            ))}
          </Stack>
        </SurfaceCard>
      </Grid>
      {stepUpModal}
    </AdminShell>
  );
}