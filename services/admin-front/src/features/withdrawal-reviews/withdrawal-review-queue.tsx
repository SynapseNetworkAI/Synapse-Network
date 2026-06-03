import { Box, Button, Stack, Text } from "@chakra-ui/react";
import { useMemo } from "react";

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
import { formatDateTime, formatUsdc, inputText } from "@/lib/admin-console";
import type { ProviderWithdrawReviewItem } from "@/services/admin-api";

import {
  getWithdrawalStatusLabel,
  getWithdrawalStatusTone,
  getWithdrawReviewKindLabel,
  getWithdrawReviewKindTone,
  getWithdrawRiskLabel,
  getWithdrawRiskTone,
  listWithdrawRiskLevels,
} from "./review-presenters";
import type { useWithdrawalReviewFilters } from "./use-withdrawal-review-filters";
import { WITHDRAWAL_REVIEW_PAGE_SIZE_OPTIONS } from "./withdrawal-review-types";

type WithdrawalReviewFilters = ReturnType<typeof useWithdrawalReviewFilters>;

export function WithdrawalReviewQueue({
  canDecide,
  filters,
  items,
  onOpenDetail,
}: Readonly<{
  canDecide: boolean;
  filters: WithdrawalReviewFilters;
  items: ProviderWithdrawReviewItem[];
  onOpenDetail: (review: ProviderWithdrawReviewItem) => void;
}>) {
  const riskLevels = useMemo(() => listWithdrawRiskLevels(items), [items]);

  return (
    <ListTableSurface
      eyebrow="待处理列表"
      title="提现审核队列"
      description="这里汇总所有需要人工确认的提现申请，按页查看，避免长列表平铺影响判断效率。"
      stamp={canDecide ? "可查看并处理" : "仅可查看"}
      filter={
        <WithdrawalReviewFilterForm filters={filters} riskLevels={riskLevels} />
      }
      table={
        filters.visibleItems.length ? (
          <WithdrawalReviewTable
            items={filters.visibleItems}
            onOpenDetail={onOpenDetail}
          />
        ) : (
          <EmptyBlock
            title="当前筛选条件下没有待处理申请"
            description="可以调整风险等级或搜索条件，查看其他需要人工确认的提现。"
          />
        )
      }
      pagination={<WithdrawalReviewPagination filters={filters} />}
    />
  );
}

function WithdrawalReviewFilterForm({
  filters,
  riskLevels,
}: Readonly<{
  filters: WithdrawalReviewFilters;
  riskLevels: ReturnType<typeof listWithdrawRiskLevels>;
}>) {
  const filterFields = useMemo(
    () => [
      ListFilterFieldPresets.keyword({
        value: filters.draftFilters.query,
        onChange: (value: string) =>
          filters.setDraftFilters((current) => ({ ...current, query: value })),
        placeholder: "搜索申请编号、用户地址或原因标签",
      }),
      ListFilterFieldPresets.status({
        key: "riskLevel",
        value: filters.draftFilters.riskLevel,
        onChange: (value: string) =>
          filters.setDraftFilters((current) => ({
            ...current,
            riskLevel: value,
          })),
        allLabel: "全部风险等级",
        options: riskLevels.map((level) => ({
          value: level,
          label: getWithdrawRiskLabel(level),
        })),
      }),
    ],
    [filters, riskLevels]
  );

  return (
    <ListFilterForm
      onSubmit={filters.applySearch}
      onReset={filters.resetFilters}
      helperText="支持回车直接搜索；重置筛选会恢复默认条件并回到第一页。"
    >
      <ListFilterFields
        templateColumns={{ base: "1fr", xl: "minmax(0, 320px) 180px" }}
        fields={filterFields}
      />
    </ListFilterForm>
  );
}

function WithdrawalReviewTable({
  items,
  onOpenDetail,
}: Readonly<{
  items: ProviderWithdrawReviewItem[];
  onOpenDetail: (review: ProviderWithdrawReviewItem) => void;
}>) {
  return (
    <DataTable>
      <TableHeaderRow>
        <Th>Withdrawal</Th>
        <Th>Owner</Th>
        <Th>Amount</Th>
        <Th>Risk</Th>
        <Th>Status</Th>
        <Th>审批过期时间</Th>
        <Th>详情</Th>
      </TableHeaderRow>
      <TableBody>
        {items.map((item) => (
          <WithdrawalReviewRow
            key={item.withdrawalId}
            item={item}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </TableBody>
    </DataTable>
  );
}

function WithdrawalReviewRow({
  item,
  onOpenDetail,
}: Readonly<{
  item: ProviderWithdrawReviewItem;
  onOpenDetail: (review: ProviderWithdrawReviewItem) => void;
}>) {
  return (
    <Box as="tr">
      <Td>
        <Stack direction="row" align="center" gap="8px" flexWrap="wrap">
          <Text fontWeight="700">{item.withdrawalId}</Text>
          <SentinelStatusChip
            label={getWithdrawReviewKindLabel(item)}
            tone={getWithdrawReviewKindTone(item)}
          />
        </Stack>
        <Text color="ink.500">{formatDateTime(item.createdAt)}</Text>
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
      <Td>{formatDateTime(item.reviewExpiresAt)}</Td>
      <Td>
        <Button
          size="sm"
          borderRadius="full"
          variant="ghost"
          onClick={() => onOpenDetail(item)}
        >
          详情
        </Button>
      </Td>
    </Box>
  );
}

function WithdrawalReviewPagination({
  filters,
}: Readonly<{ filters: WithdrawalReviewFilters }>) {
  if (!filters.filteredItems.length) {
    return null;
  }

  return (
    <ListPaginationBar
      pageSize={filters.pageSize}
      pageSizeOptions={WITHDRAWAL_REVIEW_PAGE_SIZE_OPTIONS}
      totalPages={filters.totalPages}
      totalCount={filters.filteredItems.length}
      currentPage={filters.currentPage}
      canPrevious={filters.currentPage > 1}
      canNext={filters.currentPage < filters.totalPages}
      onPageSizeChange={filters.setPageSize}
      onPrevious={() => filters.setCurrentPage((page) => Math.max(1, page - 1))}
      onNext={() =>
        filters.setCurrentPage((page) => Math.min(filters.totalPages, page + 1))
      }
    />
  );
}
