"use client";

import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
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
    return <main className="state-screen">正在同步提现审核工作台...</main>;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Withdrawal Reviews"
      title="提现审核工作台"
      description="专门处理 provider withdrawal 的人工审核队列，不再把 manual review 挤进泛审批列表里丢上下文。"
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      {message ? <MessageBanner kind="success" message={message} /> : null}

      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label="Pending reviews" value={metrics.pendingCount} meta="provider frozen state awaiting reviewer" />
        <MetricCard label="Review amount" value={formatUsdc(metrics.totalAmount)} meta="aggregated amount under review" />
        <MetricCard label="Red risk" value={metrics.redCount} meta="highest-severity manual reviews" />
        <MetricCard label="Linked on-chain" value={metrics.linkedCount} meta={`${metrics.yellowCount} yellow-risk reviews in queue`} />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1.05fr 0.95fr" }} gap="16px">
        <SurfaceCard eyebrow="Manual Review Stream" title="提现审核队列" description="高风险提现先冻结在 provider frozen，reviewer 在这里保留风控上下文、链路证据和审批动作。" stamp={`approval:read${canDecide ? " + approval:decide" : " only"}`}>
          <Grid templateColumns={{ base: "1fr", xl: "minmax(0, 320px) 180px" }} gap="12px" mb="16px">
            <SearchInput value={search} onChange={setSearch} placeholder="搜索 withdrawal / owner / risk code" />
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
            <EmptyBlock title="当前筛选下没有提现审核单" description="可以放宽风险等级或搜索条件，重新拉回人工审核队列。" />
          )}
        </SurfaceCard>

        <SurfaceCard eyebrow="Review Detail" title={activeReview?.withdrawalId ?? "Select a review"} description="专用工作台保留 evidence summary、风控原因和 reviewer note，不让这些上下文在统一审批页丢失。">
          {activeReview ? (
            <Stack gap="14px">
              <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Stack direction="row" justify="space-between" align="center">
                  <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Evidence Summary</Text>
                  <SentinelStatusChip label={(activeReview.riskLevel ?? "unknown").toUpperCase()} tone={getWithdrawRiskTone(activeReview.riskLevel)} />
                </Stack>
                <Heading mt="10px" size="sm">{inputText(activeReview.evidenceSummary ?? activeReview.message)}</Heading>
                <Text mt="8px" color="ink.500">risk code {inputText(activeReview.riskReasonCode)} · tx {inputText(activeReview.txHash)}</Text>
              </Box>
              <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="10px">
                {[
                  ["Owner", activeReview.ownerAddress],
                  ["Amount", `${formatUsdc(activeReview.amountUsdc)} USDC`],
                  ["Requested", formatDateTime(activeReview.createdAt)],
                  ["Request ID", inputText(activeReview.requestId)],
                ].map(([label, value]) => (
                  <Box key={label} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                    <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{label}</Text>
                    <Heading mt="10px" size="sm">{value}</Heading>
                  </Box>
                ))}
              </Grid>
              <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Reviewer Note</Text>
                <Box mt="10px">
                  <textarea
                    value={decisionNote}
                    onChange={(event) => setDecisionNote(event.target.value)}
                    placeholder="Record the verification result, risk rationale, or escalation notes."
                    style={nativeTextAreaStyle}
                  />
                </Box>
              </Box>
              <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="10px">
                <Button bg="signal.500" color="white" borderRadius="18px" h="52px" onClick={() => handleDecision("APPROVE")} disabled={!canDecide || isPending || !activeReview}>Approve</Button>
                <Button bg="#b83131" color="white" borderRadius="18px" h="52px" onClick={() => handleDecision("REJECT")} disabled={!canDecide || isPending || !activeReview}>Reject</Button>
              </Grid>
              {canDecide ? null : <MessageBanner kind="error" message="当前会话只有 approval:read，不能执行 approve / reject。" />}
            </Stack>
          ) : (
            <EmptyBlock title="没有选中的审核单" description="从左侧队列选择一条提现审核单，查看证据摘要并推进审批动作。" />
          )}
        </SurfaceCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "0.92fr 1.08fr" }} gap="16px">
        <SurfaceCard eyebrow="Risk Reasons" title="风险原因簇" description="先看聚类，再逐单回放，reviewer 才能知道是单个 owner 问题还是策略阈值过紧。">
          <Stack gap="12px">
            {reasonClusters.map((cluster) => (
              <Box key={cluster.code} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Stack direction="row" justify="space-between" align="center">
                  <Heading size="sm">{cluster.code}</Heading>
                  <SentinelStatusChip label={`${cluster.count} reviews`} tone={cluster.code === "manual_review" ? "gray" : "orange"} />
                </Stack>
              </Box>
            ))}
          </Stack>
        </SurfaceCard>

        <SurfaceCard eyebrow="Workflow Guardrail" title="审核动作边界" description="approve 会推进 provider frozen -> pending 并生成 ticket，reject 会释放回 available；任何动作都应保留 reviewer note 和 admin audit。">
          <Stack gap="12px">
            {[
              ["安全边界", "浏览器只拿 admin token，真正的资金推进由 gateway-admin 通过内部 adapter 调用 gateway，不暴露 gateway 管理命令给前端。"],
              ["审计要求", "review decision 必须写入 admin_action_audit，拒绝动作尤其要保留清晰的理由与证据摘要。"],
              ["队列语义", "这里只承接 provider withdrawal review，不把手工审核混回泛审批列表里丢上下文。"],
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