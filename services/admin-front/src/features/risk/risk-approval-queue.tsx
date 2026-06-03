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
import {
  getApprovalStatusLabel,
  getApprovalTypeLabel,
} from "@/features/approval/approval-presenters";
import { formatDateTime } from "@/lib/admin-console";
import type { ApprovalItem } from "@/services/admin-api";

import { getRiskLevelTone, getRiskStatusTone } from "./risk-presenters";

export function RiskApprovalQueue({
  levelFilter,
  riskItems,
  search,
  setLevelFilter,
  setSearch,
  visibleRiskItems,
}: Readonly<{
  levelFilter: string;
  riskItems: ApprovalItem[];
  search: string;
  setLevelFilter: (value: string) => void;
  setSearch: (value: string) => void;
  visibleRiskItems: ApprovalItem[];
}>) {
  return (
    <SurfaceCard
      eyebrow="Risk Approval Queue"
      title="风险相关审批"
      description="把高风险充值、大额提现和异常资金动作统一拉平，reviewer 从 dashboard 跳进来后就能直接定位。"
      stamp={`${visibleRiskItems.length}/${riskItems.length} items`}
    >
      <RiskApprovalFilters
        levelFilter={levelFilter}
        search={search}
        setLevelFilter={setLevelFilter}
        setSearch={setSearch}
      />
      <DataTable>
        <TableHeaderRow>
          <Th>Approval</Th>
          <Th>Type</Th>
          <Th>Level</Th>
          <Th>Status</Th>
          <Th>Created</Th>
        </TableHeaderRow>
        <TableBody>
          {visibleRiskItems.map((item) => (
            <RiskApprovalRow item={item} key={item.approvalId} />
          ))}
        </TableBody>
      </DataTable>
    </SurfaceCard>
  );
}

function RiskApprovalFilters({
  levelFilter,
  search,
  setLevelFilter,
  setSearch,
}: Readonly<{
  levelFilter: string;
  search: string;
  setLevelFilter: (value: string) => void;
  setSearch: (value: string) => void;
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
        placeholder="搜索审批号 / 类型 / 发起角色"
      />
      <select
        value={levelFilter}
        onChange={(event) => setLevelFilter(event.target.value)}
        style={nativeFieldStyle}
      >
        <option value="all">全部等级</option>
        <option value="L3">L3</option>
        <option value="L2">L2</option>
        <option value="L1">L1</option>
      </select>
    </Grid>
  );
}

function RiskApprovalRow({ item }: Readonly<{ item: ApprovalItem }>) {
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
      <Td>
        <SentinelStatusChip
          label={item.approvalLevel}
          tone={getRiskLevelTone(item.approvalLevel)}
        />
      </Td>
      <Td>
        <SentinelStatusChip
          label={getApprovalStatusLabel(item.status)}
          tone={getRiskStatusTone(item.status)}
        />
      </Td>
      <Td>{formatDateTime(item.createdAt)}</Td>
    </Box>
  );
}
