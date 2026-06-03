import { Box, Heading, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

import {
  DataTable,
  EmptyBlock,
  SentinelStatusChip,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";
import {
  getApprovalStatusLabel,
  getApprovalStatusTone,
  getApprovalTypeLabel,
} from "@/features/approval/approval-presenters";
import {
  getWithdrawalStatusLabel,
  getWithdrawalStatusTone,
  getWithdrawRiskLabel,
  getWithdrawRiskTone,
} from "@/features/withdrawal-reviews/review-presenters";
import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import type { ReconciliationDetail } from "@/services/admin-api";

import { DrilldownTokenButtons } from "./reconciliation-drilldown-section";
import {
  buildApprovalDrilldownTokens,
  buildWithdrawReviewDrilldownTokens,
  type DrilldownToken,
} from "./reconciliation-presenters";

type DrilldownHandler = (token: DrilldownToken) => void;

export function PriorityApprovalsSection({
  drilldownLoading,
  items,
  onDrilldown,
}: Readonly<{
  drilldownLoading: boolean;
  items: ReconciliationDetail["priorityApprovals"];
  onDrilldown: DrilldownHandler;
}>) {
  if (!items.length) {
    return (
      <EmptyBlock
        title="暂无相关审批单"
        description="当前没有与对账偏差处置直接相关的 finance approvals。"
      />
    );
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
            <Td>
              <SentinelStatusChip
                label={getApprovalStatusLabel(item.status)}
                tone={getApprovalStatusTone(item.status)}
              />
            </Td>
          </Box>
        ))}
      </TableBody>
    </DataTable>
  );
}

export function DepositRepairSection({
  drilldownLoading,
  items,
  onDrilldown,
}: Readonly<{
  drilldownLoading: boolean;
  items: ReconciliationDetail["depositRepairApprovals"];
  onDrilldown: DrilldownHandler;
}>) {
  if (!items.length) {
    return (
      <EmptyBlock
        title="暂无充值修复审批"
        description="当前没有可直接打开的 deposit_repair 审批。"
      />
    );
  }

  return (
    <Stack gap="12px">
      {items.map((item) => (
        <QueueItemCard key={item.approvalId}>
          <Stack direction="row" justify="space-between" align="center">
            <Heading size="sm">{item.approvalId}</Heading>
            <SentinelStatusChip
              label={getApprovalStatusLabel(item.status)}
              tone={getApprovalStatusTone(item.status)}
            />
          </Stack>
          <Text mt="8px" color="ink.500">
            {getApprovalTypeLabel(item.approvalType)} · {item.requesterRole}
          </Text>
          <Text mt="6px" color="ink.500">
            {formatUsdc(item.amountUsdc)} USDC ·{" "}
            {formatDateTime(item.createdAt)}
          </Text>
          <DrilldownTokenButtons
            tokens={buildApprovalDrilldownTokens(item)}
            loading={drilldownLoading}
            onClick={onDrilldown}
          />
        </QueueItemCard>
      ))}
    </Stack>
  );
}

export function WithdrawalReviewsSection({
  drilldownLoading,
  items,
  onDrilldown,
}: Readonly<{
  drilldownLoading: boolean;
  items: ReconciliationDetail["pendingWithdrawalReviews"];
  onDrilldown: DrilldownHandler;
}>) {
  if (!items.length) {
    return (
      <EmptyBlock
        title="暂无待审核提现单"
        description="当前没有挂在人工审核队列里的 provider withdrawal。"
      />
    );
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
          </Box>
        ))}
      </TableBody>
    </DataTable>
  );
}

function QueueItemCard({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      {children}
    </Box>
  );
}
