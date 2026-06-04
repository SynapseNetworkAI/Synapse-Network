"use client";

import { Box, Grid, Text } from "@chakra-ui/react";

import {
  DataTable,
  SearchInput,
  SentinelStatusChip,
  SurfaceCard,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
  nativeFieldStyle,
} from "@/components/console-ui";
import { formatDateTime, inputText } from "@/lib/admin-console";
import type { AuditActionItem } from "@/services/admin-api";

import { getAuditResultTone } from "./audit-presenters";

export function AuditLedgerTable({
  items,
  search,
  setSearch,
  setStatusFilter,
  statusFilter,
  statuses,
  totalItems,
}: Readonly<{
  items: AuditActionItem[];
  search: string;
  setSearch: (value: string) => void;
  setStatusFilter: (value: string) => void;
  statusFilter: string;
  statuses: string[];
  totalItems: number;
}>) {
  return (
    <SurfaceCard
      eyebrow="Audit Ledger"
      title="Immutable operator trail"
      description="所有审批决定、任务重试、配置发布和高风险动作都应在这里可追踪。"
      stamp={`${items.length}/${totalItems} events`}
    >
      <AuditLedgerFilters
        search={search}
        setSearch={setSearch}
        setStatusFilter={setStatusFilter}
        statusFilter={statusFilter}
        statuses={statuses}
      />
      <DataTable>
        <TableHeaderRow>
          <Th>Action</Th>
          <Th>Result</Th>
          <Th>Operator</Th>
          <Th>Resource</Th>
          <Th>Trace</Th>
          <Th>Created</Th>
        </TableHeaderRow>
        <TableBody>
          {items.map((item, index) => (
            <AuditLedgerRow
              item={item}
              key={`${item.auditId ?? index}-${item.actionType}`}
            />
          ))}
        </TableBody>
      </DataTable>
    </SurfaceCard>
  );
}

function AuditLedgerFilters({
  search,
  setSearch,
  setStatusFilter,
  statusFilter,
  statuses,
}: Readonly<{
  search: string;
  setSearch: (value: string) => void;
  setStatusFilter: (value: string) => void;
  statusFilter: string;
  statuses: string[];
}>) {
  return (
    <Grid
      templateColumns={{ base: "1fr", xl: "minmax(0, 320px) 180px" }}
      gap="12px"
      mb="16px"
    >
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="搜索 operator / resource / approval / job"
      />
      <select
        value={statusFilter}
        onChange={(event) => setStatusFilter(event.target.value)}
        style={nativeFieldStyle}
      >
        <option value="all">全部结果</option>
        {statuses.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
    </Grid>
  );
}

function AuditLedgerRow({ item }: Readonly<{ item: AuditActionItem }>) {
  return (
    <Box as="tr">
      <Td>
        <Text fontWeight="700">{item.actionType}</Text>
        <Text color="ink.500">audit #{item.auditId ?? "n/a"}</Text>
      </Td>
      <Td>
        <SentinelStatusChip
          label={item.resultStatus}
          tone={getAuditResultTone(item.resultStatus)}
        />
      </Td>
      <Td>
        <Text>{inputText(item.operatorEmail)}</Text>
        <Text color="ink.500">{inputText(item.operatorRole)}</Text>
      </Td>
      <Td>
        <Text>{inputText(item.resourceType)}</Text>
        <Text color="ink.500">{inputText(item.resourceId)}</Text>
      </Td>
      <Td>
        <Text>{inputText(item.approvalId)}</Text>
        <Text color="ink.500">job {inputText(item.jobId)}</Text>
      </Td>
      <Td>{formatDateTime(item.createdAt)}</Td>
    </Box>
  );
}
