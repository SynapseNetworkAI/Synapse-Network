"use client";

import { Box, Text } from "@chakra-ui/react";
import type { Dispatch, SetStateAction } from "react";

import {
  DataTable,
  EmptyBlock,
  ListFilterFieldPresets,
  ListFilterFields,
  ListFilterForm,
  ListPaginationBar,
  ListTableSurface,
  SentinelStatusChip,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";
import { APPROVAL_STATUS } from "@/domain/status";
import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import type { ApprovalItem } from "@/services/admin-api";

import {
  getApprovalLevelTone,
  getApprovalStatusLabel,
  getApprovalStatusTone,
  getApprovalTypeLabel,
} from "./approval-presenters";
import {
  APPROVAL_PAGE_SIZE_OPTIONS,
  type ApprovalFilters,
} from "./use-approval-queue";

export function ApprovalListWorkbench({
  applySearch,
  approvalTypes,
  currentPage,
  draftFilters,
  filteredCount,
  items,
  pageSize,
  resetFilters,
  setCurrentPage,
  setDraftFilters,
  setPageSize,
  totalCount,
  totalPages,
}: Readonly<{
  applySearch: () => void;
  approvalTypes: string[];
  currentPage: number;
  draftFilters: ApprovalFilters;
  filteredCount: number;
  items: ApprovalItem[];
  pageSize: number;
  resetFilters: () => void;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  setDraftFilters: Dispatch<SetStateAction<ApprovalFilters>>;
  setPageSize: (value: number) => void;
  totalCount: number;
  totalPages: number;
}>) {
  return (
    <ListTableSurface
      eyebrow="Unified Projection"
      title="审批队列"
      description="统一审批列表直接消费 provider manual review 投影，reviewer 不再在多套待办之间切换。"
      stamp={`${filteredCount}/${totalCount} approvals`}
      filter={
        <ApprovalFiltersForm
          applySearch={applySearch}
          approvalTypes={approvalTypes}
          draftFilters={draftFilters}
          resetFilters={resetFilters}
          setDraftFilters={setDraftFilters}
        />
      }
      table={
        items.length ? (
          <ApprovalTable items={items} />
        ) : (
          <EmptyBlock
            title="当前筛选条件下没有审批单"
            description="可以调整类型或状态条件，查看其他待处理审批。"
          />
        )
      }
      pagination={
        filteredCount ? (
          <ListPaginationBar
            pageSize={pageSize}
            pageSizeOptions={APPROVAL_PAGE_SIZE_OPTIONS}
            totalPages={totalPages}
            totalCount={filteredCount}
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
  );
}

function ApprovalFiltersForm({
  applySearch,
  approvalTypes,
  draftFilters,
  resetFilters,
  setDraftFilters,
}: Readonly<{
  applySearch: () => void;
  approvalTypes: string[];
  draftFilters: ApprovalFilters;
  resetFilters: () => void;
  setDraftFilters: Dispatch<SetStateAction<ApprovalFilters>>;
}>) {
  const filterFields = [
    ListFilterFieldPresets.keyword({
      value: draftFilters.query,
      onChange: (value: string) =>
        setDraftFilters((current) => ({ ...current, query: value })),
      placeholder: "搜索审批号 / 类型 / 发起角色",
    }),
    ListFilterFieldPresets.status({
      allLabel: "全部类型",
      key: "type",
      onChange: (value: string) =>
        setDraftFilters((current) => ({ ...current, type: value })),
      options: approvalTypes.map((approvalType) => ({
        label: getApprovalTypeLabel(approvalType),
        value: approvalType,
      })),
      value: draftFilters.type,
    }),
    ListFilterFieldPresets.status({
      allLabel: "全部状态",
      key: "status",
      onChange: (value: string) =>
        setDraftFilters((current) => ({ ...current, status: value })),
      options: [
        { value: APPROVAL_STATUS.SUBMITTED, label: "待分派" },
        { value: APPROVAL_STATUS.UNDER_REVIEW, label: "审核中" },
        {
          value: APPROVAL_STATUS.APPROVED_PENDING_EXECUTION,
          label: "待执行",
        },
        { value: APPROVAL_STATUS.REJECTED, label: "已拒绝" },
        { value: APPROVAL_STATUS.EXECUTED, label: "已执行" },
      ],
      value: draftFilters.status,
    }),
  ];

  return (
    <ListFilterForm
      onSubmit={applySearch}
      onReset={resetFilters}
      helperText="支持回车直接搜索；重置筛选会恢复默认条件并回到第一页。"
    >
      <ListFilterFields
        templateColumns={{ base: "1fr", xl: "minmax(0, 320px) 180px 180px" }}
        fields={filterFields}
      />
    </ListFilterForm>
  );
}

function ApprovalTable({ items }: Readonly<{ items: ApprovalItem[] }>) {
  return (
    <DataTable>
      <TableHeaderRow>
        <Th>Approval</Th>
        <Th>Type</Th>
        <Th>Amount</Th>
        <Th>Level</Th>
        <Th>Status</Th>
        <Th>Created</Th>
      </TableHeaderRow>
      <TableBody>
        {items.map((item) => (
          <ApprovalTableRow item={item} key={item.approvalId} />
        ))}
      </TableBody>
    </DataTable>
  );
}

function ApprovalTableRow({ item }: Readonly<{ item: ApprovalItem }>) {
  return (
    <Box as="tr">
      <Td>
        <Text fontWeight="700">{item.approvalId}</Text>
        <Text color="ink.500">{item.requesterRole}</Text>
      </Td>
      <Td>
        <Text>{getApprovalTypeLabel(item.approvalType)}</Text>
        <Text color="ink.500">{item.approvalType}</Text>
      </Td>
      <Td>{formatUsdc(item.amountUsdc)}</Td>
      <Td>
        <SentinelStatusChip
          label={item.approvalLevel}
          tone={getApprovalLevelTone(item.approvalLevel)}
        />
      </Td>
      <Td>
        <SentinelStatusChip
          label={getApprovalStatusLabel(item.status)}
          tone={getApprovalStatusTone(item.status)}
        />
      </Td>
      <Td>{formatDateTime(item.createdAt)}</Td>
    </Box>
  );
}
