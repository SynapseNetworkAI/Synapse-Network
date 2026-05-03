"use client";

import { Text } from "@chakra-ui/react";

import {
  FinanceOperationsList,
  type FinanceRecordColumn,
  type FinanceRecordQuery,
} from "@/features/finance/finance-operations-list";
import { formatDateTime, formatUsdc, inputText } from "@/lib/admin-console";
import {
  listConsumerDeposits,
  type ConsumerDepositItem,
} from "@/services/admin-operations-api";
import { StatusChip } from "@/components/console-ui";

const depositStatusOptions = [
  { value: "PENDING_CONFIRMATION", label: "pending" },
  { value: "CONFIRMED", label: "confirmed" },
  { value: "FAILED", label: "failed" },
];

const columns: FinanceRecordColumn<ConsumerDepositItem>[] = [
  {
    header: "Deposit",
    render: (deposit) => (
      <>
        <Text fontWeight="800">{deposit.depositId}</Text>
        <Text color="ink.500" fontSize="13px">
          {inputText(deposit.network)}
        </Text>
      </>
    ),
  },
  {
    header: "Owner",
    render: (deposit) => (
      <>
        <Text>{deposit.ownerWallet}</Text>
        <Text color="ink.500" fontSize="13px">
          {inputText(deposit.ownerEmail)}
        </Text>
      </>
    ),
  },
  {
    header: "Tx",
    render: (deposit) => (
      <Text maxW="260px" overflowWrap="anywhere">
        {deposit.txHash}
      </Text>
    ),
  },
  {
    header: "Amount",
    render: (deposit) => <>${formatUsdc(deposit.amountUsdc)}</>,
  },
  {
    header: "Status",
    render: (deposit) => <StatusChip value={deposit.status} />,
  },
  {
    header: "Credited",
    render: (deposit) => (
      <>{formatDateTime(deposit.creditedAt ?? deposit.updatedAt)}</>
    ),
  },
];

export function ConsumerDepositsTable({ token }: Readonly<{ token: string }>) {
  return (
    <FinanceOperationsList
      columns={columns}
      description="按钱包、tx hash、状态和时间查询充值流水。V1 只读诊断，不在这里做手工修复。"
      emptyDescription="当前筛选条件下没有 consumer deposit。"
      emptyTitle="暂无充值记录"
      eyebrow="Consumer Deposits"
      load={(activeToken: string, params: FinanceRecordQuery) =>
        listConsumerDeposits(activeToken, params)
      }
      rowKey={(deposit) => deposit.depositId}
      statusOptions={depositStatusOptions}
      submitLabel="查询充值"
      title="用户充值记录"
      token={token}
      txHashPlaceholder="Tx hash"
      walletPlaceholder="Owner wallet"
    />
  );
}
