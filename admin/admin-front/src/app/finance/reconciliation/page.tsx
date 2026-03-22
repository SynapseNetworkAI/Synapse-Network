"use client";

import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { DataTable, EmptyBlock, MessageBanner, MetricCard, MetricLabelWithHint, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th } from "@/components/console-ui";
import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  buildApprovalDrilldownTokens,
  buildReconciliationBreakdownCards,
  buildReconciliationQueueCards,
  buildWithdrawReviewDrilldownTokens,
  describeImbalance,
  formatSignedUsdc,
  type DrilldownToken,
  resolveDrilldownCount,
  resolveDrilldownTitle,
  resolveReconciliationStamp,
} from "@/features/finance/reconciliation-presenters";
import { getFinanceMetricGlossary } from "@/features/finance/finance-glossary";
import { getApprovalStatusLabel, getApprovalTypeLabel } from "@/features/approval/approval-presenters";
import { getWithdrawRiskTone } from "@/features/withdrawal-reviews/review-presenters";
import { getReconciliationDetail, getReconciliationDrilldown, type ReconciliationDetail, type ReconciliationDrilldownResult } from "@/services/admin-api";

function resolveTone(detail: ReconciliationDetail): "green" | "orange" | "red" {
  if (detail.reconciliationAlert) {
    return "red";
  }
  if (detail.imbalanceDirection !== "balanced") {
    return "orange";
  }
  return "green";
}

function resolveApprovalStatusTone(status: string): "green" | "orange" | "red" | "gray" {
  if (status === "APPROVED_PENDING_EXECUTION") {
    return "orange";
  }
  if (status === "REJECTED") {
    return "red";
  }
  if (status === "EXECUTED") {
    return "green";
  }
  return "gray";
}

function DrilldownTokenButtons({
  tokens,
  loading,
  onClick,
}: Readonly<{
  tokens: DrilldownToken[];
  loading: boolean;
  onClick: (token: DrilldownToken) => void;
}>) {
  if (!tokens.length) {
    return null;
  }

  return (
    <Stack mt="10px" direction="row" gap="8px" flexWrap="wrap">
      {tokens.map((tokenConfig) => (
        <Button
          key={`${tokenConfig.kind}:${tokenConfig.value}`}
          size="xs"
          borderRadius="full"
          variant="outline"
          onClick={() => onClick(tokenConfig)}
          loading={loading}
        >
          {tokenConfig.label}
        </Button>
      ))}
    </Stack>
  );
}

function PriorityApprovalsSection({
  items,
  drilldownLoading,
  onDrilldown,
}: Readonly<{
  items: ReconciliationDetail["priorityApprovals"];
  drilldownLoading: boolean;
  onDrilldown: (token: DrilldownToken) => void;
}>) {
  if (!items.length) {
    return <EmptyBlock title="暂无相关审批单" description="当前没有与对账偏差处置直接相关的 finance approvals。" />;
  }

  return (
    <DataTable>
      <TableHeaderRow>
        <Th>Approval</Th>
        <Th>Type</Th>
        <Th>Amount</Th>
        <Th>Status</Th>
      </TableHeaderRow>
      <TableBody>
        {items.map((item) => (
          <Box as="tr" key={item.approvalId}>
            <Td>
              <Text fontWeight="700">{item.approvalId}</Text>
              <Text color="ink.500">{formatDateTime(item.createdAt)}</Text>
              <DrilldownTokenButtons
                tokens={buildApprovalDrilldownTokens(item)}
                loading={drilldownLoading}
                onClick={onDrilldown}
              />
            </Td>
            <Td>
              <Text>{getApprovalTypeLabel(item.approvalType)}</Text>
              <Text color="ink.500">{item.requesterRole}</Text>
            </Td>
            <Td>{formatUsdc(item.amountUsdc)} USDC</Td>
            <Td><SentinelStatusChip label={getApprovalStatusLabel(item.status)} tone={resolveApprovalStatusTone(item.status)} /></Td>
          </Box>
        ))}
      </TableBody>
    </DataTable>
  );
}

function DepositRepairSection({
  items,
  drilldownLoading,
  onDrilldown,
}: Readonly<{
  items: ReconciliationDetail["depositRepairApprovals"];
  drilldownLoading: boolean;
  onDrilldown: (token: DrilldownToken) => void;
}>) {
  if (!items.length) {
    return <EmptyBlock title="暂无充值修复审批" description="当前没有可直接打开的 deposit_repair 审批。" />;
  }

  return (
    <Stack gap="12px">
      {items.map((item) => (
        <Box key={item.approvalId} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
          <Stack direction="row" justify="space-between" align="center">
            <Heading size="sm">{item.approvalId}</Heading>
            <SentinelStatusChip label={getApprovalStatusLabel(item.status)} tone={resolveApprovalStatusTone(item.status)} />
          </Stack>
          <Text mt="8px" color="ink.500">{getApprovalTypeLabel(item.approvalType)} · {item.requesterRole}</Text>
          <Text mt="6px" color="ink.500">{formatUsdc(item.amountUsdc)} USDC · {formatDateTime(item.createdAt)}</Text>
          <DrilldownTokenButtons
            tokens={buildApprovalDrilldownTokens(item)}
            loading={drilldownLoading}
            onClick={onDrilldown}
          />
        </Box>
      ))}
    </Stack>
  );
}

function WithdrawalReviewsSection({
  items,
  drilldownLoading,
  onDrilldown,
}: Readonly<{
  items: ReconciliationDetail["pendingWithdrawalReviews"];
  drilldownLoading: boolean;
  onDrilldown: (token: DrilldownToken) => void;
}>) {
  if (!items.length) {
    return <EmptyBlock title="暂无待审核提现单" description="当前没有挂在人工审核队列里的 provider withdrawal。" />;
  }

  return (
    <DataTable>
      <TableHeaderRow>
        <Th>Withdrawal</Th>
        <Th>Owner</Th>
        <Th>Amount</Th>
        <Th>Risk</Th>
        <Th>Status</Th>
      </TableHeaderRow>
      <TableBody>
        {items.map((item) => (
          <Box as="tr" key={item.withdrawalId}>
            <Td>
              <Text fontWeight="700">{item.withdrawalId}</Text>
              <Text color="ink.500">{formatDateTime(item.createdAt)}</Text>
              <DrilldownTokenButtons
                tokens={buildWithdrawReviewDrilldownTokens(item)}
                loading={drilldownLoading}
                onClick={onDrilldown}
              />
            </Td>
            <Td>
              <Text>{item.ownerAddress}</Text>
              <Text color="ink.500">{item.requestId ?? "-"}</Text>
            </Td>
            <Td>{formatUsdc(item.amountUsdc)} USDC</Td>
            <Td><SentinelStatusChip label={(item.riskLevel ?? "unknown").toUpperCase()} tone={getWithdrawRiskTone(item.riskLevel)} /></Td>
            <Td><SentinelStatusChip label={item.status} tone={item.status === "PENDING_MANUAL_REVIEW" ? "orange" : "gray"} /></Td>
          </Box>
        ))}
      </TableBody>
    </DataTable>
  );
}

function CrossLocatorSection({
  drilldown,
  drilldownError,
}: Readonly<{
  drilldown: ReconciliationDrilldownResult | null;
  drilldownError: string | null;
}>) {
  if (!drilldown) {
    return (
      <>
        {drilldownError ? <MessageBanner kind="error" message={drilldownError} /> : null}
        <EmptyBlock title="还没有选择 locator" description="从上面的三组异常列表中点击 Owner、Request ID 或 Tx Hash，开始统一交叉定位。" />
      </>
    );
  }

  return (
    <>
      {drilldownError ? <MessageBanner kind="error" message={drilldownError} /> : null}
      <Stack gap="16px">
        <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
          <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">Matched items</Text>
          <Heading mt="10px" size="md">{resolveDrilldownCount(drilldown)}</Heading>
          <Text mt="8px" color="ink.500">priority approvals {drilldown.priorityApprovals.length} · deposit repair {drilldown.depositRepairApprovals.length} · withdrawal reviews {drilldown.pendingWithdrawalReviews.length}</Text>
        </Box>
        <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr 1fr" }} gap="12px">
          <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
            <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">Priority approvals</Text>
            <Stack mt="10px" gap="10px">
              {drilldown.priorityApprovals.length ? drilldown.priorityApprovals.map((item) => (
                <Box key={`priority-${item.approvalId}`}>
                  <Text fontWeight="700">{item.approvalId}</Text>
                  <Text color="ink.500">{getApprovalTypeLabel(item.approvalType)} · {getApprovalStatusLabel(item.status)}</Text>
                </Box>
              )) : <Text color="ink.500">No matches</Text>}
            </Stack>
          </Box>
          <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
            <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">Deposit repair</Text>
            <Stack mt="10px" gap="10px">
              {drilldown.depositRepairApprovals.length ? drilldown.depositRepairApprovals.map((item) => (
                <Box key={`repair-${item.approvalId}`}>
                  <Text fontWeight="700">{item.approvalId}</Text>
                  <Text color="ink.500">{formatUsdc(item.amountUsdc)} USDC · {getApprovalStatusLabel(item.status)}</Text>
                </Box>
              )) : <Text color="ink.500">No matches</Text>}
            </Stack>
          </Box>
          <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
            <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">Withdrawal reviews</Text>
            <Stack mt="10px" gap="10px">
              {drilldown.pendingWithdrawalReviews.length ? drilldown.pendingWithdrawalReviews.map((item) => (
                <Box key={`review-${item.withdrawalId}`}>
                  <Text fontWeight="700">{item.withdrawalId}</Text>
                  <Text color="ink.500">{item.ownerAddress} · {(item.riskLevel ?? "unknown").toUpperCase()}</Text>
                </Box>
              )) : <Text color="ink.500">No matches</Text>}
            </Stack>
          </Box>
        </Grid>
      </Stack>
    </>
  );
}

export default function ReconciliationDetailPage() {
  const { admin, token, loading } = useAdminSession();
  const [detail, setDetail] = useState<ReconciliationDetail | null>(null);
  const [drilldown, setDrilldown] = useState<ReconciliationDrilldownResult | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    const activeToken = token;
    let cancelled = false;

    async function load() {
      try {
        const payload = await getReconciliationDetail(activeToken);
        if (!cancelled) {
          setDetail(payload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载对账详情失败");
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const breakdownCards = useMemo(() => detail ? buildReconciliationBreakdownCards(detail) : [], [detail]);
  const queueCards = useMemo(() => detail ? buildReconciliationQueueCards(detail) : [], [detail]);

  async function handleDrilldown(tokenConfig: DrilldownToken) {
    if (!token) {
      return;
    }

    setDrilldownLoading(true);
    setDrilldownError(null);
    try {
      const payload = await getReconciliationDrilldown(token, { [tokenConfig.kind]: tokenConfig.value });
      setDrilldown(payload);
    } catch (loadError) {
      setDrilldownError(loadError instanceof Error ? loadError.message : "加载交叉定位结果失败");
    } finally {
      setDrilldownLoading(false);
    }
  }

  if (loading || !admin || bootstrapping) {
    return <ControlPlaneLoadingScreen title="Reconciliation Detail Sync" message="正在同步对账详情..." />;
  }

  if (!detail) {
    return (
      <AdminShell
        admin={admin}
        eyebrow="Finance Admin"
        title="账本对账详情"
        description="把首页哨兵里的账本对账差额展开成可操作的值班视图。"
      >
        {error ? <MessageBanner kind="error" message={error} /> : <MessageBanner kind="error" message="对账详情暂时不可用。" />}
      </AdminShell>
    );
  }

  const tone = resolveTone(detail);
  const stamp = resolveReconciliationStamp(detail);
  const topMetricColumns = { base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(5, 1fr)" };

  return (
    <AdminShell
      admin={admin}
      eyebrow="Finance Admin"
      title="账本对账详情"
      description="展示链上 vault、账本义务、带方向的净偏差，以及与处置优先级强相关的 backlog。"
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}

      <Grid templateColumns={topMetricColumns} gap="16px">
        <MetricCard
          label={<MetricLabelWithHint label={getFinanceMetricGlossary("platformIncome").label} hint={getFinanceMetricGlossary("platformIncome").hint} />}
          value={`${formatUsdc(detail.platformFeeBalanceUsdc)} USDC`}
          meta={getFinanceMetricGlossary("platformIncome").meta}
        />
        <MetricCard
          label={<MetricLabelWithHint label={getFinanceMetricGlossary("absoluteDelta").label} hint={getFinanceMetricGlossary("absoluteDelta").hint} />}
          value={`${formatUsdc(detail.reconciliationDeltaUsdc)} USDC`}
          meta={getFinanceMetricGlossary("absoluteDelta").meta}
        />
        <MetricCard
          label={<MetricLabelWithHint label={getFinanceMetricGlossary("signedDifference").label} hint={getFinanceMetricGlossary("signedDifference").hint} />}
          value={formatSignedUsdc(detail.signedDifferenceUsdc)}
          meta={getFinanceMetricGlossary("signedDifference").meta}
        />
        <MetricCard
          label={<MetricLabelWithHint label={getFinanceMetricGlossary("chainVault").label} hint={getFinanceMetricGlossary("chainVault").hint} />}
          value={detail.chainVaultUsdc ? `${formatUsdc(detail.chainVaultUsdc)} USDC` : "n/a"}
          meta={getFinanceMetricGlossary("chainVault").meta}
        />
        <MetricCard
          label={<MetricLabelWithHint label={getFinanceMetricGlossary("ledgerObligation").label} hint={getFinanceMetricGlossary("ledgerObligation").hint} />}
          value={detail.ledgerObligationUsdc ? `${formatUsdc(detail.ledgerObligationUsdc)} USDC` : "n/a"}
          meta={getFinanceMetricGlossary("ledgerObligation").meta}
        />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1.1fr 0.9fr" }} gap="16px">
        <SurfaceCard
          eyebrow="Drift Breakdown"
          title="对账拆解"
          description={describeImbalance(detail)}
          stamp={stamp}
          actions={<Link href="/dashboard"><Button size="sm" borderRadius="full">返回 Dashboard</Button></Link>}
        >
          <Stack direction="row" gap="10px" mb="16px" flexWrap="wrap">
            <SentinelStatusChip label={detail.reconciliationAlert ? "alert" : "nominal"} tone={tone} />
            <SentinelStatusChip label={detail.gatewayStatus} tone={detail.gatewayStatus === "healthy" ? "green" : "red"} />
            <SentinelStatusChip label={detail.imbalanceDirection.replace("_", " ")} tone={tone} />
          </Stack>
          <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="12px">
            {breakdownCards.map((card) => (
              <Box key={card.label} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">{card.label}</Text>
                <Heading mt="10px" size="md">{card.value}</Heading>
                <Text mt="8px" color="ink.500">{card.description}</Text>
              </Box>
            ))}
          </Grid>
          <Box mt="12px" borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
            <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">Last reconciliation markers</Text>
            <Text mt="10px" color="ink.500">Last reconciliation: {detail.lastReconciliationAt ? formatDateTime(detail.lastReconciliationAt) : "n/a"}</Text>
            <Text mt="6px" color="ink.500">Runtime state updated: {detail.runtimeStateUpdatedAt ? formatDateTime(detail.runtimeStateUpdatedAt) : "n/a"}</Text>
            <Text mt="6px" color="ink.500">Projection stamp: {stamp}</Text>
            {detail.reconciliationLastError ? <Text mt="10px" color="#8f1d1d">Last error: {detail.reconciliationLastError}</Text> : null}
          </Box>
        </SurfaceCard>

        <SurfaceCard
          eyebrow="Operator Context"
          title="关联处置面"
          description="对账偏差本身不是全部，operator 还需要同时看到审批积压、充值异常和提现排队。"
          actions={<Link href="/finance"><Button size="sm" borderRadius="full">打开 Finance Desk</Button></Link>}
        >
          <Stack gap="12px">
            {queueCards.map((card) => (
              <Box key={card.label} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">{card.label}</Text>
                <Heading mt="10px" size="md">{card.value}</Heading>
                <Text mt="8px" color="ink.500">{card.description}</Text>
              </Box>
            ))}
            <Box borderRadius="20px" p="16px" bg="rgba(15,17,21,0.94)" color="#f4f7fb">
              <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="rgba(244,247,251,0.62)">Capital context</Text>
              <Text mt="10px" color="rgba(244,247,251,0.82)">Owner liability: {formatUsdc(detail.ownerLiabilityUsdc)} USDC</Text>
              <Text mt="6px" color="rgba(244,247,251,0.82)">Provider payable: {formatUsdc(detail.providerPayableUsdc)} USDC</Text>
              <Text mt="6px" color="rgba(244,247,251,0.82)">Platform fee balance: {formatUsdc(detail.platformFeeBalanceUsdc)} USDC</Text>
              <Text mt="6px" color="rgba(244,247,251,0.82)">Pending deposits: {detail.pendingDepositCount}</Text>
            </Box>
          </Stack>
        </SurfaceCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <SurfaceCard
          eyebrow="Exception Queue"
          title="相关审批单"
          description="这里聚合对账偏差处置最相关的 finance approvals，避免 operator 再从首页回忆该去哪张表。"
          actions={<Link href="/approvals?status=UNDER_REVIEW"><Button size="sm" borderRadius="full">打开审批中心</Button></Link>}
        >
          <PriorityApprovalsSection
            items={detail.priorityApprovals}
            drilldownLoading={drilldownLoading}
            onDrilldown={(tokenConfig) => void handleDrilldown(tokenConfig)}
          />
        </SurfaceCard>

        <SurfaceCard
          eyebrow="Deposit Repair"
          title="充值异常处置审批"
          description="当前还没有独立的充值异常单列表接口，这里展示最相关的 deposit_repair 审批，作为异常处置入口。"
          actions={<Link href="/approvals?type=deposit_repair"><Button size="sm" borderRadius="full">只看充值修复</Button></Link>}
        >
          <DepositRepairSection
            items={detail.depositRepairApprovals}
            drilldownLoading={drilldownLoading}
            onDrilldown={(tokenConfig) => void handleDrilldown(tokenConfig)}
          />
        </SurfaceCard>
      </Grid>

      <SurfaceCard
        eyebrow="Withdrawal Reviews"
        title="提现审核队列联动"
        description="对账异常常常伴随出账审核积压，这里直接露出待审核提现单并保留风险上下文。"
        actions={<Link href="/withdrawal-reviews"><Button size="sm" borderRadius="full">打开提现审核台</Button></Link>}
      >
        <WithdrawalReviewsSection
          items={detail.pendingWithdrawalReviews}
          drilldownLoading={drilldownLoading}
          onDrilldown={(tokenConfig) => void handleDrilldown(tokenConfig)}
        />
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Cross Locator"
        title={drilldown ? resolveDrilldownTitle(drilldown) : "统一交叉定位"}
        description="点击任一 owner、requestId 或 txHash，在同一页里交叉拉出审批、充值修复和提现审核三张关联结果。"
        actions={drilldown ? <Button size="sm" borderRadius="full" onClick={() => { setDrilldown(null); setDrilldownError(null); }}>清空定位</Button> : undefined}
      >
        <CrossLocatorSection
          drilldown={drilldown}
          drilldownError={drilldownError}
        />
      </SurfaceCard>
    </AdminShell>
  );
}