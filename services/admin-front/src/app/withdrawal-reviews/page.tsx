"use client";

import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import {
  DataTable,
  EmptyBlock,
  ListFilterFieldPresets,
  ListFilterFields,
  ListFilterForm,
  ListPaginationBar,
  ListTableSurface,
  MessageBanner,
  MetricCard,
  OverlayPanel,
  SentinelStatusChip,
  SurfaceCard,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
  nativeTextAreaStyle,
} from "@/components/console-ui";
import {
  buildWithdrawReasonClusters,
  buildWithdrawReviewMetrics,
  filterWithdrawReviews,
  getWithdrawalStatusLabel,
  getWithdrawalStatusTone,
  getWithdrawReviewKindLabel,
  getWithdrawReviewKindTone,
  getWithdrawRiskLabel,
  getWithdrawRiskTone,
  listWithdrawRiskLevels,
  paginateWithdrawReviews,
} from "@/features/withdrawal-reviews/review-presenters";
import { formatDateTime, formatUsdc, inputText } from "@/lib/admin-console";
import { useProviderWithdrawReviews } from "@/features/withdrawal-reviews/use-provider-withdraw-reviews";
import { useAdminStepUp } from "@/lib/use-admin-step-up";
import { useAdminSession } from "@/lib/use-admin-session";
import type { ProviderWithdrawReviewItem } from "@/services/admin-api";
import {
  getWithdrawReviewActionButtonLabel,
  getWithdrawReviewActionNotice,
} from "@/features/withdrawal-reviews/review-action-feedback";

const PAGE_SIZE = 6;

type WithdrawalReviewFilters = {
  query: string;
  riskLevel: string;
};

const DEFAULT_FILTERS: WithdrawalReviewFilters = {
  query: "",
  riskLevel: "all",
};

const PAGE_SIZE_OPTIONS = [6, 10, 20];

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
    actionPhase,
    pendingDecision,
    setActiveReviewId,
    setDecisionNote,
    setMessage,
    handleDecision,
    resetActionState,
  } = useProviderWithdrawReviews(token, requestStepUpCode);
  const canDecide = admin?.permissions.includes("approval:decide") ?? false;
  const [draftFilters, setDraftFilters] =
    useState<WithdrawalReviewFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<WithdrawalReviewFilters>(DEFAULT_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailReviewSnapshot, setDetailReviewSnapshot] =
    useState<ProviderWithdrawReviewItem | null>(null);

  const metrics = useMemo(() => buildWithdrawReviewMetrics(items), [items]);
  const riskLevels = useMemo(() => listWithdrawRiskLevels(items), [items]);
  const reasonClusters = useMemo(
    () => buildWithdrawReasonClusters(items).slice(0, 4),
    [items]
  );
  const filteredItems = useMemo(
    () =>
      filterWithdrawReviews(
        items,
        appliedFilters.query,
        appliedFilters.riskLevel
      ),
    [appliedFilters, items]
  );
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const visibleItems = useMemo(
    () => paginateWithdrawReviews(filteredItems, currentPage, pageSize),
    [currentPage, filteredItems, pageSize]
  );
  const filterFields = useMemo(
    () => [
      ListFilterFieldPresets.keyword({
        value: draftFilters.query,
        onChange: (value: string) =>
          setDraftFilters((current) => ({ ...current, query: value })),
        placeholder: "搜索申请编号、用户地址或原因标签",
      }),
      ListFilterFieldPresets.status({
        key: "riskLevel",
        value: draftFilters.riskLevel,
        onChange: (value: string) =>
          setDraftFilters((current) => ({ ...current, riskLevel: value })),
        allLabel: "全部风险等级",
        options: riskLevels.map((level) => ({
          value: level,
          label: getWithdrawRiskLabel(level),
        })),
      }),
    ],
    [draftFilters, riskLevels]
  );

  useEffect(() => {
    if (globalThis.window === undefined) {
      return;
    }

    const params = new URLSearchParams(globalThis.window.location.search);
    const nextFilters = {
      query: params.get("q") ?? "",
      riskLevel: params.get("risk") ?? "all",
    };
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
  }, []);

  useEffect(() => {
    if (isDetailOpen && detailReviewSnapshot?.withdrawalId === activeReviewId) {
      return;
    }

    const nextActiveId = filteredItems.some(
      (item) => item.withdrawalId === activeReviewId
    )
      ? activeReviewId
      : filteredItems[0]?.withdrawalId ?? null;
    if (nextActiveId !== activeReviewId) {
      setActiveReviewId(nextActiveId);
      setDecisionNote("");
    }
  }, [
    activeReviewId,
    detailReviewSnapshot,
    filteredItems,
    isDetailOpen,
    setActiveReviewId,
    setDecisionNote,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedFilters, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const activeReview =
    filteredItems.find((item) => item.withdrawalId === activeReviewId) ?? null;
  const detailReview = isDetailOpen
    ? detailReviewSnapshot ?? activeReview
    : activeReview;
  const actionNotice = getWithdrawReviewActionNotice(
    actionPhase,
    pendingDecision
  );

  function openReviewDetail(review: ProviderWithdrawReviewItem) {
    setActiveReviewId(review.withdrawalId);
    setDetailReviewSnapshot(review);
    resetActionState();
    setMessage(null);
    setIsDetailOpen(true);
  }

  function closeReviewDetail() {
    setIsDetailOpen(false);
    setDetailReviewSnapshot(null);
    resetActionState();
    if (
      activeReviewId &&
      !filteredItems.some((item) => item.withdrawalId === activeReviewId)
    ) {
      setActiveReviewId(filteredItems[0]?.withdrawalId ?? null);
    }
  }

  function applySearch() {
    setAppliedFilters(draftFilters);
    setCurrentPage(1);
  }

  function resetFilters() {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setCurrentPage(1);
  }

  if (loading || !admin) {
    return (
      <ControlPlaneLoadingScreen
        title="提现处理同步中"
        message="正在加载待处理的提现申请..."
      />
    );
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="提现处理"
      title="提现审核工作台"
      description="集中查看需要人工确认的提现申请，帮助业务、财务和风控同学更快判断该放行、驳回，还是继续跟进。"
      actions={
        <Link href="/review-history">
          <Button size="sm" borderRadius="full">
            审核历史
          </Button>
        </Link>
      }
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      {message ? <MessageBanner kind="success" message={message} /> : null}
      {actionNotice ? (
        <Box
          borderRadius="18px"
          border="1px solid rgba(15,17,21,0.08)"
          bg="rgba(15,17,21,0.03)"
          p="14px 16px"
        >
          <Text fontWeight="600" color="ink.700">
            {actionNotice}
          </Text>
        </Box>
      ) : null}

      <Grid
        templateColumns={{
          base: "1fr",
          md: "repeat(2, 1fr)",
          xl: "repeat(4, 1fr)",
        }}
        gap="16px"
      >
        <MetricCard
          label="待处理申请"
          value={metrics.pendingCount}
          meta="当前等待人工确认的提现笔数"
        />
        <MetricCard
          label="待确认金额"
          value={formatUsdc(metrics.totalAmount)}
          meta="当前列表涉及的提现总额"
        />
        <MetricCard
          label="优先处理"
          value={metrics.redCount}
          meta="建议先处理的高关注申请"
        />
        <MetricCard
          label="已关联流水"
          value={metrics.linkedCount}
          meta={`另有 ${metrics.yellowCount} 笔需要持续关注`}
        />
      </Grid>

      <ListTableSurface
        eyebrow="待处理列表"
        title="提现审核队列"
        description="这里汇总所有需要人工确认的提现申请，按页查看，避免长列表平铺影响判断效率。"
        stamp={canDecide ? "可查看并处理" : "仅可查看"}
        filter={
          <ListFilterForm
            onSubmit={applySearch}
            onReset={resetFilters}
            helperText="支持回车直接搜索；重置筛选会恢复默认条件并回到第一页。"
          >
            <ListFilterFields
              templateColumns={{ base: "1fr", xl: "minmax(0, 320px) 180px" }}
              fields={filterFields}
            />
          </ListFilterForm>
        }
        table={
          visibleItems.length ? (
            <DataTable>
              <TableHeaderRow>
                <Th>Withdrawal</Th>
                <Th>Owner</Th>
                <Th>Amount</Th>
                <Th>Risk</Th>
                <Th>Status</Th>
                <Th>详情</Th>
              </TableHeaderRow>
              <TableBody>
                {visibleItems.map((item) => (
                  <Box as="tr" key={item.withdrawalId}>
                    <Td>
                      <Stack
                        direction="row"
                        align="center"
                        gap="8px"
                        flexWrap="wrap"
                      >
                        <Text fontWeight="700">{item.withdrawalId}</Text>
                        <SentinelStatusChip
                          label={getWithdrawReviewKindLabel(item)}
                          tone={getWithdrawReviewKindTone(item)}
                        />
                      </Stack>
                      <Text color="ink.500">
                        {formatDateTime(item.createdAt)}
                      </Text>
                    </Td>
                    <Td>
                      <Text>{item.ownerAddress}</Text>
                      <Text color="ink.500">{inputText(item.requestId)}</Text>
                    </Td>
                    <Td>{formatUsdc(item.amountUsdc)}</Td>
                    <Td>
                      <SentinelStatusChip
                        label={getWithdrawRiskLabel(item.riskLevel)}
                        tone={getWithdrawRiskTone(item.riskLevel)}
                      />
                    </Td>
                    <Td>
                      <SentinelStatusChip
                        label={getWithdrawalStatusLabel(item.status)}
                        tone={getWithdrawalStatusTone(item.status)}
                      />
                    </Td>
                    <Td>
                      <Button
                        size="sm"
                        borderRadius="full"
                        variant="ghost"
                        onClick={() => openReviewDetail(item)}
                      >
                        详情
                      </Button>
                    </Td>
                  </Box>
                ))}
              </TableBody>
            </DataTable>
          ) : (
            <EmptyBlock
              title="当前筛选条件下没有待处理申请"
              description="可以调整风险等级或搜索条件，查看其他需要人工确认的提现。"
            />
          )
        }
        pagination={
          filteredItems.length ? (
            <ListPaginationBar
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              totalPages={totalPages}
              totalCount={filteredItems.length}
              currentPage={currentPage}
              canPrevious={currentPage > 1}
              canNext={currentPage < totalPages}
              onPageSizeChange={setPageSize}
              onPrevious={() => setCurrentPage((page) => Math.max(1, page - 1))}
              onNext={() =>
                setCurrentPage((page) => Math.min(totalPages, page + 1))
              }
            />
          ) : null
        }
      />

      <Grid templateColumns={{ base: "1fr", xl: "0.92fr 1.08fr" }} gap="16px">
        <SurfaceCard
          eyebrow="原因分布"
          title="常见触发原因"
          description="先看哪些原因最集中，再决定是逐笔处理，还是统一排查某一类问题。"
        >
          <Stack gap="12px">
            {reasonClusters.map((cluster) => (
              <Box
                key={cluster.code}
                borderRadius="22px"
                p="16px"
                bg="rgba(255,255,255,0.74)"
                border="1px solid rgba(99,92,82,0.10)"
              >
                <Stack direction="row" justify="space-between" align="center">
                  <Heading size="sm">{cluster.code}</Heading>
                  <SentinelStatusChip
                    label={`${cluster.count} 笔`}
                    tone={cluster.code === "manual_review" ? "gray" : "orange"}
                  />
                </Stack>
              </Box>
            ))}
          </Stack>
        </SurfaceCard>

        <SurfaceCard
          eyebrow="处理说明"
          title="操作注意事项"
          description="提交结果前，请确认判断依据和备注完整，方便后续追踪、复核和对外沟通。"
        >
          <Stack gap="12px">
            {[
              [
                "处理结果",
                "放行后，申请会进入后续出款流程；驳回后，会回到可用状态并保留处理记录。",
              ],
              [
                "备注要求",
                "无论通过还是驳回，都建议写清楚核实结果和处理原因，方便后续查询与复盘。",
              ],
              [
                "页面定位",
                "这里专门处理需要人工确认的提现申请，避免和其他审批事项混在一起，影响判断效率。",
              ],
            ].map(([title, description]) => (
              <Box
                key={title}
                borderRadius="22px"
                p="16px"
                bg="rgba(255,255,255,0.74)"
                border="1px solid rgba(99,92,82,0.10)"
              >
                <Heading size="sm">{title}</Heading>
                <Text mt="8px" color="ink.500">
                  {description}
                </Text>
              </Box>
            ))}
          </Stack>
        </SurfaceCard>
      </Grid>

      <OverlayPanel
        open={isDetailOpen && detailReview !== null}
        title={detailReview?.withdrawalId ?? "申请详情"}
        description="查看这笔提现的关键资料、处理依据和备注，确认后再提交放行或驳回。"
        onClose={closeReviewDetail}
      >
        {detailReview ? (
          <Stack gap="14px">
            {error ? <MessageBanner kind="error" message={error} /> : null}
            {message ? (
              <MessageBanner kind="success" message={message} />
            ) : null}
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
                  处理摘要
                </Text>
                <Stack direction="row" gap="8px">
                  <SentinelStatusChip
                    label={getWithdrawReviewKindLabel(detailReview)}
                    tone={getWithdrawReviewKindTone(detailReview)}
                  />
                  <SentinelStatusChip
                    label={getWithdrawRiskLabel(detailReview.riskLevel)}
                    tone={getWithdrawRiskTone(detailReview.riskLevel)}
                  />
                </Stack>
              </Stack>
              <Heading mt="10px" size="sm">
                {inputText(
                  detailReview.evidenceSummary ?? detailReview.message
                )}
              </Heading>
              <Text mt="8px" color="ink.500">
                原因标签 {inputText(detailReview.riskReasonCode)} · 流水号{" "}
                {inputText(detailReview.txHash)}
              </Text>
            </Box>
            <Grid
              templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }}
              gap="10px"
            >
              {[
                ["用户地址", detailReview.ownerAddress],
                ["提现金额", `${formatUsdc(detailReview.amountUsdc)} USDC`],
                ["申请时间", formatDateTime(detailReview.createdAt)],
                ["申请编号", inputText(detailReview.requestId)],
              ].map(([label, value]) => (
                <Box
                  key={label}
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
              ))}
            </Grid>
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
              <Button
                bg="signal.500"
                color="white"
                borderRadius="18px"
                h="52px"
                onClick={() => handleDecision("APPROVE")}
                disabled={!canDecide || isPending || !detailReview}
                loading={
                  isPending &&
                  pendingDecision === "APPROVE" &&
                  actionPhase === "submitting"
                }
                loadingText="放行提交中"
              >
                {getWithdrawReviewActionButtonLabel(
                  "APPROVE",
                  actionPhase,
                  pendingDecision
                )}
              </Button>
              <Button
                bg="#b83131"
                color="white"
                borderRadius="18px"
                h="52px"
                onClick={() => handleDecision("REJECT")}
                disabled={!canDecide || isPending || !detailReview}
                loading={
                  isPending &&
                  pendingDecision === "REJECT" &&
                  actionPhase === "submitting"
                }
                loadingText="驳回提交中"
              >
                {getWithdrawReviewActionButtonLabel(
                  "REJECT",
                  actionPhase,
                  pendingDecision
                )}
              </Button>
            </Grid>
            {canDecide ? null : (
              <MessageBanner
                kind="error"
                message="当前账号只有查看权限，不能提交处理结果。"
              />
            )}
          </Stack>
        ) : null}
      </OverlayPanel>
      {stepUpModal}
    </AdminShell>
  );
}
