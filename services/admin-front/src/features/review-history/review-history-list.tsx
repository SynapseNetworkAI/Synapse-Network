import { Box, Button, Text } from "@chakra-ui/react";
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
import type { ProviderWithdrawReviewHistoryItem } from "@/services/admin-api";

import {
  getReviewDecisionLabel,
  getReviewDecisionTone,
  getReviewHistoryStatusLabel,
  getReviewHistoryStatusTone,
} from "./review-history-presenters";
import {
  REVIEW_HISTORY_PAGE_SIZE_OPTIONS,
  type useReviewHistory,
} from "./use-review-history";

type ReviewHistoryState = ReturnType<typeof useReviewHistory>;

export function ReviewHistoryLedger({
  history,
}: Readonly<{ history: ReviewHistoryState }>) {
  return (
    <ListTableSurface
      eyebrow="Review Ledger"
      title="审核结果台账"
      description="给业务同学一个直接可读的审核历史面板，不必切到审计页再手动拼状态。"
      stamp={`共 ${history.totalCount} 条`}
      filter={<ReviewHistoryFilterForm history={history} />}
      table={
        history.items.length === 0 ? (
          <EmptyBlock
            title="当前没有匹配的审核历史"
            description="调整筛选条件后，这里会展示已处理提现的状态回放。"
          />
        ) : (
          <ReviewHistoryTable
            items={history.items}
            onOpenDetail={history.openDetail}
          />
        )
      }
      pagination={<ReviewHistoryPagination history={history} />}
    />
  );
}

function ReviewHistoryFilterForm({
  history,
}: Readonly<{ history: ReviewHistoryState }>) {
  const filterFields = useMemo(
    () => [
      ListFilterFieldPresets.keyword({
        value: history.draftFilters.query,
        onChange: (value: string) => history.updateDraftFilter("query", value),
        placeholder: "搜索提现单 / 用户地址 / requestId / reviewer",
      }),
      {
        key: "reviewer",
        kind: "text" as const,
        value: history.draftFilters.reviewer,
        onChange: (value: string) =>
          history.updateDraftFilter("reviewer", value),
        placeholder: "reviewer 邮箱或角色",
        listId: "review-history-reviewers",
        listOptions: history.reviewers,
      },
      ListFilterFieldPresets.status({
        key: "currentStatus",
        value: history.draftFilters.currentStatus,
        onChange: (value: string) =>
          history.updateDraftFilter("currentStatus", value),
        allLabel: "全部当前状态",
        options: history.statuses.map((status) => ({
          value: status,
          label: getReviewHistoryStatusLabel(status),
        })),
      }),
      ListFilterFieldPresets.status({
        key: "reviewDecision",
        value: history.draftFilters.reviewDecision,
        onChange: (value: string) =>
          history.updateDraftFilter("reviewDecision", value),
        allLabel: "全部处理结论",
        options: [
          { value: "APPROVE", label: "放行" },
          { value: "REJECT", label: "驳回" },
        ],
      }),
      ...ListFilterFieldPresets.dateRange({
        startKey: "reviewedFrom",
        startValue: history.draftFilters.reviewedFrom,
        onStartChange: (value: string) =>
          history.updateDraftFilter("reviewedFrom", value),
        endKey: "reviewedTo",
        endValue: history.draftFilters.reviewedTo,
        onEndChange: (value: string) =>
          history.updateDraftFilter("reviewedTo", value),
      }),
    ],
    [history]
  );

  return (
    <ListFilterForm
      onSubmit={history.applySearch}
      onReset={history.resetFilters}
      loading={history.isFetching}
      helperText="支持回车直接搜索；重置筛选会恢复默认条件并回到第一页。"
    >
      <ListFilterFields
        templateColumns={{
          base: "1fr",
          md: "repeat(2, 1fr)",
          xl: "minmax(0, 1.8fr) minmax(0, 1.2fr) repeat(4, minmax(0, 0.9fr))",
        }}
        fields={filterFields}
      />
    </ListFilterForm>
  );
}

function ReviewHistoryTable({
  items,
  onOpenDetail,
}: Readonly<{
  items: ProviderWithdrawReviewHistoryItem[];
  onOpenDetail: (item: ProviderWithdrawReviewHistoryItem) => void;
}>) {
  return (
    <DataTable>
      <TableHeaderRow>
        <Th>提现单</Th>
        <Th>提现用户</Th>
        <Th>提现金额</Th>
        <Th>处理结论</Th>
        <Th>当前状态</Th>
        <Th>处理人</Th>
        <Th>备注</Th>
        <Th>处理时间</Th>
        <Th>详情</Th>
      </TableHeaderRow>
      <TableBody>
        {items.map((item) => (
          <ReviewHistoryRow
            key={item.withdrawalId}
            item={item}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </TableBody>
    </DataTable>
  );
}

function ReviewHistoryRow({
  item,
  onOpenDetail,
}: Readonly<{
  item: ProviderWithdrawReviewHistoryItem;
  onOpenDetail: (item: ProviderWithdrawReviewHistoryItem) => void;
}>) {
  return (
    <Box as="tr">
      <Td>
        <Text fontWeight="700">{item.withdrawalId}</Text>
      </Td>
      <Td>
        <Text>{inputText(item.ownerAddress)}</Text>
      </Td>
      <Td>
        <Text fontWeight="700">{formatUsdc(item.amountUsdc ?? "0")}</Text>
      </Td>
      <Td>
        <SentinelStatusChip
          label={getReviewDecisionLabel(item.reviewDecision)}
          tone={getReviewDecisionTone(item.reviewDecision)}
        />
      </Td>
      <Td>
        <SentinelStatusChip
          label={getReviewHistoryStatusLabel(item.currentStatus)}
          tone={getReviewHistoryStatusTone(item.currentStatus)}
        />
      </Td>
      <Td>
        <Text>{inputText(item.reviewerEmail)}</Text>
      </Td>
      <Td>
        <Text>{inputText(item.reviewerNote ?? item.message)}</Text>
      </Td>
      <Td>{formatDateTime(item.reviewedAt)}</Td>
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

function ReviewHistoryPagination({
  history,
}: Readonly<{ history: ReviewHistoryState }>) {
  return (
    <ListPaginationBar
      pageSize={history.pageSize}
      pageSizeOptions={REVIEW_HISTORY_PAGE_SIZE_OPTIONS}
      totalPages={history.totalPages}
      totalCount={history.totalCount}
      currentPage={history.pageNumber}
      loading={history.isFetching}
      canPrevious={history.cursorHistory.length > 0}
      canNext={Boolean(history.nextCursor)}
      onPageSizeChange={history.setPageSize}
      onPrevious={history.goToPreviousPage}
      onNext={history.goToNextPage}
    />
  );
}
