"use client";

import { Text } from "@chakra-ui/react";

import { StatusChip } from "@/components/console-ui";
import {
  FinanceOperationsList,
  type FinanceRecordColumn,
  type FinanceRecordQuery,
} from "@/features/finance/finance-operations-list";
import { formatDateTime, formatUsdc, inputText } from "@/lib/admin-console";
import {
  listProviderWithdrawals,
  type ProviderWithdrawalItem,
} from "@/services/admin-operations-api";

const withdrawalStatusOptions = [
  { value: "REQUESTED", label: "requested" },
  { value: "PENDING_MANUAL_REVIEW", label: "manual review" },
  { value: "SIGNED", label: "ticket ready" },
  { value: "COMPLETED", label: "completed" },
  { value: "FAILED", label: "failed" },
  { value: "FAILED_EXPIRED", label: "expired" },
  { value: "REJECTED", label: "rejected" },
];

const columns: FinanceRecordColumn<ProviderWithdrawalItem>[] = [
  {
    header: "Withdrawal",
    render: (withdrawal) => (
      <>
        <Text fontWeight="800">{withdrawal.withdrawalId}</Text>
        <Text color="ink.500" fontSize="13px">
          {inputText(withdrawal.ticketId)}
        </Text>
      </>
    ),
  },
  {
    header: "Provider",
    render: (withdrawal) => (
      <>
        <Text>{inputText(withdrawal.providerName)}</Text>
        <Text color="ink.500" fontSize="13px">
          {withdrawal.ownerWallet}
        </Text>
      </>
    ),
  },
  {
    header: "Amount / fee",
    render: (withdrawal) => (
      <>
        <Text>${formatUsdc(withdrawal.amountUsdc)}</Text>
        <Text color="ink.500" fontSize="13px">
          fee{" "}
          {withdrawal.feeUsdc ? `$${formatUsdc(withdrawal.feeUsdc)}` : "n/a"}
        </Text>
      </>
    ),
  },
  {
    header: "Status",
    render: (withdrawal) => <StatusChip value={withdrawal.status} />,
  },
  {
    header: "Funds",
    render: (withdrawal) => <>{withdrawal.fundsState}</>,
  },
  {
    header: "Updated",
    render: (withdrawal) => (
      <>{formatDateTime(withdrawal.updatedAt ?? withdrawal.createdAt)}</>
    ),
  },
];

export function ProviderWithdrawalsTable({
  token,
}: Readonly<{ token: string }>) {
  return (
    <FinanceOperationsList
      columns={columns}
      description="展示所有 Provider withdrawal 状态；人工审核队列仍在提现审核页，这里负责全量查账和证据追踪。"
      emptyDescription="当前筛选条件下没有 provider withdrawal。"
      emptyTitle="暂无 Provider 提现"
      eyebrow="Provider Withdrawals"
      load={(activeToken: string, params: FinanceRecordQuery) =>
        listProviderWithdrawals(activeToken, params)
      }
      rowKey={(withdrawal) => withdrawal.withdrawalId}
      statusOptions={withdrawalStatusOptions}
      submitLabel="查询提现"
      title="Provider 提现记录"
      token={token}
      txHashPlaceholder="Claim tx hash"
      walletPlaceholder="Provider wallet"
    />
  );
}
