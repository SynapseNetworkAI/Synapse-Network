import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

import {
  EmptyBlock,
  MessageBanner,
  SurfaceCard,
} from "@/components/console-ui";
import { formatUsdc } from "@/lib/admin-console";
import type { ReconciliationDrilldownResult } from "@/services/admin-api";

import {
  getApprovalStatusLabel,
  getApprovalTypeLabel,
} from "../approval/approval-presenters";
import type { DrilldownToken } from "./reconciliation-presenters";
import {
  resolveDrilldownCount,
  resolveDrilldownTitle,
} from "./reconciliation-presenters";

export function DrilldownTokenButtons({
  loading,
  onClick,
  tokens,
}: Readonly<{
  loading: boolean;
  onClick: (token: DrilldownToken) => void;
  tokens: DrilldownToken[];
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

export function ReconciliationCrossLocatorSection({
  drilldown,
  drilldownError,
}: Readonly<{
  drilldown: ReconciliationDrilldownResult | null;
  drilldownError: string | null;
}>) {
  if (!drilldown) {
    return (
      <>
        {drilldownError ? (
          <MessageBanner kind="error" message={drilldownError} />
        ) : null}
        <EmptyBlock
          title="还没有选择 locator"
          description="从上面的三组异常列表中点击 Owner、Request ID 或 Tx Hash，开始统一交叉定位。"
        />
      </>
    );
  }

  return (
    <>
      {drilldownError ? (
        <MessageBanner kind="error" message={drilldownError} />
      ) : null}
      <Stack gap="16px">
        <ReconciliationDrilldownSummary drilldown={drilldown} />
        <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr 1fr" }} gap="12px">
          <PriorityApprovalMatches drilldown={drilldown} />
          <DepositRepairMatches drilldown={drilldown} />
          <WithdrawalReviewMatches drilldown={drilldown} />
        </Grid>
      </Stack>
    </>
  );
}

export function ReconciliationCrossLocatorCard({
  drilldown,
  drilldownError,
  onClear,
}: Readonly<{
  drilldown: ReconciliationDrilldownResult | null;
  drilldownError: string | null;
  onClear: () => void;
}>) {
  return (
    <SurfaceCard
      eyebrow="Cross Locator"
      title={drilldown ? resolveDrilldownTitle(drilldown) : "统一交叉定位"}
      description="点击任一 owner、requestId 或 txHash，在同一页里交叉拉出审批、充值修复和提现审核三张关联结果。"
      actions={
        drilldown ? (
          <Button size="sm" borderRadius="full" onClick={onClear}>
            清空定位
          </Button>
        ) : undefined
      }
    >
      <ReconciliationCrossLocatorSection
        drilldown={drilldown}
        drilldownError={drilldownError}
      />
    </SurfaceCard>
  );
}

function ReconciliationDrilldownSummary({
  drilldown,
}: Readonly<{ drilldown: ReconciliationDrilldownResult }>) {
  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Text
        fontSize="11px"
        letterSpacing="0.18em"
        textTransform="uppercase"
        color="ink.500"
      >
        Matched items
      </Text>
      <Heading mt="10px" size="md">
        {resolveDrilldownCount(drilldown)}
      </Heading>
      <Text mt="8px" color="ink.500">
        priority approvals {drilldown.priorityApprovals.length} · deposit repair{" "}
        {drilldown.depositRepairApprovals.length} · withdrawal reviews{" "}
        {drilldown.pendingWithdrawalReviews.length}
      </Text>
    </Box>
  );
}

function PriorityApprovalMatches({
  drilldown,
}: Readonly<{ drilldown: ReconciliationDrilldownResult }>) {
  return (
    <DrilldownMatchCard title="Priority approvals">
      {drilldown.priorityApprovals.length ? (
        drilldown.priorityApprovals.map((item) => (
          <Box key={`priority-${item.approvalId}`}>
            <Text fontWeight="700">{item.approvalId}</Text>
            <Text color="ink.500">
              {getApprovalTypeLabel(item.approvalType)} ·{" "}
              {getApprovalStatusLabel(item.status)}
            </Text>
          </Box>
        ))
      ) : (
        <Text color="ink.500">No matches</Text>
      )}
    </DrilldownMatchCard>
  );
}

function DepositRepairMatches({
  drilldown,
}: Readonly<{ drilldown: ReconciliationDrilldownResult }>) {
  return (
    <DrilldownMatchCard title="Deposit repair">
      {drilldown.depositRepairApprovals.length ? (
        drilldown.depositRepairApprovals.map((item) => (
          <Box key={`repair-${item.approvalId}`}>
            <Text fontWeight="700">{item.approvalId}</Text>
            <Text color="ink.500">
              {formatUsdc(item.amountUsdc)} USDC ·{" "}
              {getApprovalStatusLabel(item.status)}
            </Text>
          </Box>
        ))
      ) : (
        <Text color="ink.500">No matches</Text>
      )}
    </DrilldownMatchCard>
  );
}

function WithdrawalReviewMatches({
  drilldown,
}: Readonly<{ drilldown: ReconciliationDrilldownResult }>) {
  return (
    <DrilldownMatchCard title="Withdrawal reviews">
      {drilldown.pendingWithdrawalReviews.length ? (
        drilldown.pendingWithdrawalReviews.map((item) => (
          <Box key={`review-${item.withdrawalId}`}>
            <Text fontWeight="700">{item.withdrawalId}</Text>
            <Text color="ink.500">
              {item.ownerAddress} ·{" "}
              {(item.riskLevel ?? "unknown").toUpperCase()}
            </Text>
          </Box>
        ))
      ) : (
        <Text color="ink.500">No matches</Text>
      )}
    </DrilldownMatchCard>
  );
}

function DrilldownMatchCard({
  children,
  title,
}: Readonly<{ children: ReactNode; title: string }>) {
  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Text
        fontSize="11px"
        letterSpacing="0.18em"
        textTransform="uppercase"
        color="ink.500"
      >
        {title}
      </Text>
      <Stack mt="10px" gap="10px">
        {children}
      </Stack>
    </Box>
  );
}
