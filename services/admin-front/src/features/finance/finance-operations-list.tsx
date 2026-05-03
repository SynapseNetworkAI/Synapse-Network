"use client";

import { Box, Stack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  DataTable,
  EmptyBlock,
  ListFilterFieldPresets,
  ListFilterFields,
  ListFilterForm,
  ListPaginationBar,
  ListTableSurface,
  MessageBanner,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";
import type { AdminListPagination } from "@/services/admin-operations-api";

export type FinanceRecordQuery = {
  wallet?: string;
  txHash?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

export type FinanceRecordPage<T> = {
  items: T[];
  pagination: AdminListPagination;
};

export type FinanceRecordColumn<T> = {
  header: string;
  render: (item: T) => ReactNode;
};

export function FinanceOperationsList<T extends { [key: string]: unknown }>({
  columns,
  description,
  emptyDescription,
  emptyTitle,
  eyebrow,
  load,
  rowKey,
  statusOptions,
  submitLabel,
  title,
  token,
  txHashPlaceholder,
  walletPlaceholder,
}: Readonly<{
  columns: FinanceRecordColumn<T>[];
  description: string;
  emptyDescription: string;
  emptyTitle: string;
  eyebrow: string;
  load: (
    token: string,
    params: FinanceRecordQuery
  ) => Promise<FinanceRecordPage<T>>;
  rowKey: (item: T) => string;
  statusOptions: { value: string; label: string }[];
  submitLabel: string;
  title: string;
  token: string;
  txHashPlaceholder: string;
  walletPlaceholder: string;
}>) {
  const [wallet, setWallet] = useState("");
  const [txHash, setTxHash] = useState("");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [payload, setPayload] = useState<FinanceRecordPage<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const params = useMemo(
    () => ({
      wallet: wallet.trim() || undefined,
      txHash: txHash.trim() || undefined,
      status: status === "all" ? undefined : status,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page,
      pageSize,
    }),
    [dateFrom, dateTo, page, pageSize, status, txHash, wallet]
  );

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setError(null);
        const result = await load(token, params);
        if (!cancelled) {
          setPayload(result);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : `${title} 加载失败`
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [load, params, title, token]);

  const rows = payload?.items ?? [];
  const pagination = payload?.pagination;

  return (
    <Stack gap="16px">
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <ListTableSurface
        eyebrow={eyebrow}
        title={title}
        description={description}
        stamp={`共 ${pagination?.total ?? 0} 条`}
        filter={
          <ListFilterForm
            onSubmit={() => setPage(1)}
            onReset={() => {
              setWallet("");
              setTxHash("");
              setStatus("all");
              setDateFrom("");
              setDateTo("");
              setPage(1);
            }}
            loading={loading}
            submitLabel={submitLabel}
          >
            <ListFilterFields
              templateColumns={{
                base: "1fr",
                xl: "1.2fr 1.2fr 0.9fr 0.8fr 0.8fr",
              }}
              fields={[
                {
                  key: "wallet",
                  kind: "text",
                  value: wallet,
                  onChange: setWallet,
                  placeholder: walletPlaceholder,
                },
                {
                  key: "txHash",
                  kind: "text",
                  value: txHash,
                  onChange: setTxHash,
                  placeholder: txHashPlaceholder,
                },
                ListFilterFieldPresets.status({
                  key: "status",
                  value: status,
                  onChange: (value) => {
                    setStatus(value);
                    setPage(1);
                  },
                  allLabel: "全部状态",
                  options: statusOptions,
                }),
                ...ListFilterFieldPresets.dateRange({
                  startKey: "from",
                  startValue: dateFrom,
                  onStartChange: setDateFrom,
                  endKey: "to",
                  endValue: dateTo,
                  onEndChange: setDateTo,
                }),
              ]}
            />
          </ListFilterForm>
        }
        table={
          rows.length === 0 ? (
            <EmptyBlock title={emptyTitle} description={emptyDescription} />
          ) : (
            <DataTable>
              <TableHeaderRow>
                {columns.map((column) => (
                  <Th key={column.header}>{column.header}</Th>
                ))}
              </TableHeaderRow>
              <TableBody>
                {rows.map((row) => (
                  <Box as="tr" key={rowKey(row)}>
                    {columns.map((column) => (
                      <Td key={column.header}>{column.render(row)}</Td>
                    ))}
                  </Box>
                ))}
              </TableBody>
            </DataTable>
          )
        }
        pagination={
          pagination ? (
            <ListPaginationBar
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100, 200]}
              totalPages={pagination.totalPages}
              totalCount={pagination.total}
              currentPage={page}
              loading={loading}
              canPrevious={pagination.hasPreviousPage}
              canNext={pagination.hasNextPage}
              onPageSizeChange={(next) => {
                setPageSize(next);
                setPage(1);
              }}
              onPrevious={() => setPage((current) => Math.max(1, current - 1))}
              onNext={() => setPage((current) => current + 1)}
            />
          ) : null
        }
      />
    </Stack>
  );
}
