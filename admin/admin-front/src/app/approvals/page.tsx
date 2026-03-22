"use client";

import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { DataTable, MessageBanner, MetricCard, SearchInput, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th, nativeFieldStyle } from "@/components/console-ui";
import { formatDateTime, formatUsdc, toneFromStatus } from "@/lib/admin-console";
import { useAdminSession } from "@/lib/use-admin-session";
import { buildApprovalMetrics, filterApprovals, getApprovalLevelTone, getApprovalStatusLabel, getApprovalTypeLabel, listApprovalTypes, sortApprovalsByPriority } from "@/features/approval/approval-presenters";
import { listApprovals, type ApprovalItem } from "@/services/admin-api";

export default function ApprovalsPage() {
  const { admin, token, loading } = useAdminSession();
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const metrics = useMemo(() => buildApprovalMetrics(items), [items]);
  const approvalTypes = useMemo(() => listApprovalTypes(items), [items]);
  const filteredItems = useMemo(
    () => sortApprovalsByPriority(filterApprovals(items, deferredSearch, typeFilter, statusFilter)),
    [deferredSearch, items, statusFilter, typeFilter],
  );
  const hotItems = filteredItems.slice(0, 4);

  useEffect(() => {
    if (globalThis.window === undefined) {
      return;
    }

    const params = new URLSearchParams(globalThis.window.location.search);
    setSearch(params.get("q") ?? "");
    setTypeFilter(params.get("type") ?? "all");
    setStatusFilter(params.get("status") ?? "all");
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;

    let cancelled = false;

    async function load() {
      try {
        const approvals = await listApprovals(activeToken);
        if (cancelled) {
          return;
        }
        setItems(approvals.items);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载审批列表失败");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || !admin) {
    return <ControlPlaneLoadingScreen title="Approval Queue Projection" message="正在读取审批队列..." />;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Approval Workflow"
      title="审批中心"
      description="高风险财务和配置动作必须经过多级审批，执行人和审批人保持职责分离；provider manual review 现在直接投影进统一审批队列。"
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}

      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label="Queue depth" value={metrics.total} meta="all approval projections in one queue" />
        <MetricCard label="Projected withdrawals" value={metrics.projectedWithdrawCount} meta={`${formatUsdc(metrics.projectedWithdrawAmount)} USDC under review`} />
        <MetricCard label="L3 hot items" value={metrics.l3Count} meta="highest-risk approvals needing fast review" />
        <MetricCard label="Pending execution" value={metrics.pendingExecutionCount} meta="approved but not yet executed" />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1.1fr 0.9fr" }} gap="16px">
        <SurfaceCard eyebrow="Unified Projection" title="审批队列" description="统一审批列表直接消费 provider manual review 投影，reviewer 不再在多套待办之间切换。" stamp={`${filteredItems.length}/${items.length} approvals`}>
          <Grid templateColumns={{ base: "1fr", xl: "minmax(0, 320px) 180px 180px" }} gap="12px" mb="16px">
            <SearchInput value={search} onChange={setSearch} placeholder="搜索审批号 / 类型 / 发起角色" />
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={nativeFieldStyle}>
              <option value="all">全部类型</option>
              {approvalTypes.map((approvalType) => <option key={approvalType} value={approvalType}>{getApprovalTypeLabel(approvalType)}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={nativeFieldStyle}>
              <option value="all">全部状态</option>
              <option value="SUBMITTED">待分派</option>
              <option value="UNDER_REVIEW">审核中</option>
              <option value="APPROVED_PENDING_EXECUTION">待执行</option>
              <option value="REJECTED">已拒绝</option>
              <option value="EXECUTED">已执行</option>
            </select>
          </Grid>
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
              {filteredItems.map((item) => (
                <Box as="tr" key={item.approvalId}>
                  <Td>
                    <Text fontWeight="700">{item.approvalId}</Text>
                    <Text color="ink.500">{item.requesterRole}</Text>
                  </Td>
                  <Td>
                    <Text>{getApprovalTypeLabel(item.approvalType)}</Text>
                    <Text color="ink.500">{item.approvalType}</Text>
                  </Td>
                  <Td>{formatUsdc(item.amountUsdc)}</Td>
                  <Td><SentinelStatusChip label={item.approvalLevel} tone={getApprovalLevelTone(item.approvalLevel)} /></Td>
                  <Td><SentinelStatusChip label={getApprovalStatusLabel(item.status)} tone={toneFromStatus(item.status)} /></Td>
                  <Td>{formatDateTime(item.createdAt)}</Td>
                </Box>
              ))}
            </TableBody>
          </DataTable>
        </SurfaceCard>

        <Stack gap="16px">
          <SurfaceCard eyebrow="Hot Queue" title="优先处理项" description="按风险等级、审核状态和类型做优先级排序，先把最值得 reviewer 打开的单子顶出来。" actions={<Link href="/withdrawal-reviews"><Button size="sm" borderRadius="full">提现专用工作台</Button></Link>}>
            <Stack gap="12px">
              {hotItems.map((item) => (
                <Box key={item.approvalId} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                  <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">{getApprovalTypeLabel(item.approvalType)}</Text>
                  <Heading mt="8px" size="sm">{item.approvalId}</Heading>
                  <Text mt="8px" color="ink.500">{item.requesterRole} · {formatUsdc(item.amountUsdc)} USDC</Text>
                  <Stack mt="12px" direction="row" gap="8px" flexWrap="wrap">
                    <SentinelStatusChip label={item.approvalLevel} tone={getApprovalLevelTone(item.approvalLevel)} />
                    <SentinelStatusChip label={getApprovalStatusLabel(item.status)} tone={toneFromStatus(item.status)} />
                  </Stack>
                </Box>
              ))}
            </Stack>
          </SurfaceCard>

          <SurfaceCard eyebrow="Flow Rules" title="审批分级" description="读取权限和审批权限完全解耦，统一队列只负责总览，深度证据仍去专用工作台。">
            <Stack gap="12px">
              <Text color="ink.500">`provider manual review` 先在统一队列暴露风险面，保证负责人能在一个面板看到需要处理的资金动作。</Text>
              <Text color="ink.500">需要 evidence summary、reviewer note 和更细风险上下文时，再跳转到专用提现审核面板做决定。</Text>
              <Text color="ink.500">执行环节继续和审批环节拆开，避免 reviewer 在信息不足时直接撞执行系统。</Text>
            </Stack>
          </SurfaceCard>
        </Stack>
      </Grid>
    </AdminShell>
  );
}
