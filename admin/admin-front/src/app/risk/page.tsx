"use client";

import { Box, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { DataTable, MessageBanner, MetricCard, SearchInput, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th, nativeFieldStyle } from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import { getApprovalStatusLabel, getApprovalTypeLabel } from "@/features/approval/approval-presenters";
import { buildRiskMetrics, filterRiskApprovals, filterVisibleRiskItems, sortRiskItems } from "@/features/risk/risk-presenters";
import { useAdminSession } from "@/lib/use-admin-session";
import { listApprovals, type ApprovalItem } from "@/services/admin-api";

function riskLevelTone(level: string): "green" | "orange" | "red" | "gray" {
  if (level === "L3") {
    return "red";
  }
  if (level === "L2") {
    return "orange";
  }
  return "gray";
}

function riskStatusTone(status: string): "green" | "orange" | "red" | "gray" {
  if (status === "UNDER_REVIEW") {
    return "orange";
  }
  if (status === "SUBMITTED") {
    return "gray";
  }
  return "green";
}

export default function RiskPage() {
  const { admin, token, loading } = useAdminSession();
  const [riskItems, setRiskItems] = useState<ApprovalItem[]>([]);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const visibleRiskItems = useMemo(
    () => sortRiskItems(filterVisibleRiskItems(riskItems, deferredSearch, levelFilter)),
    [deferredSearch, levelFilter, riskItems],
  );
  const metrics = useMemo(() => buildRiskMetrics(riskItems), [riskItems]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    async function load() {
      try {
        const approvals = await listApprovals(activeToken, { limit: 20 });
        if (!cancelled) {
          setRiskItems(filterRiskApprovals(approvals.items));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载风控模块失败");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || !admin) {
    return <main className="state-screen">正在构建风控工作台...</main>;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Risk Console"
      title="风控工作台"
      description="风险标签、阈值策略和异常资金动作不应该散在脚本里，而应该进入后台控制面编排。"
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}

      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label="Risk queue" value={metrics.total} meta="L2/L3 or finance-sensitive approval projections" />
        <MetricCard label="L3 alerts" value={metrics.red} meta="highest-risk approvals needing fastest response" />
        <MetricCard label="L2 warnings" value={metrics.yellow} meta="operator-visible degraded but not critical" />
        <MetricCard label="Under review" value={metrics.underReview} meta={`${metrics.submitted} still waiting to be picked up`} />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "0.88fr 1.12fr" }} gap="16px">
        <SurfaceCard eyebrow="Policy Domains" title="风控模块树" description="风险策略、名单维护和高风险资金动作不应该散在脚本里，而应该在控制面编排。">
          <Stack gap="12px">
            {[
              ["高风险充值", "发现链上确认成功但链下入账异常、来源地址异常或大额集中充值。"],
              ["大额提现审核", "超阈值提现统一进入 reviewer 决策和 execution queue。"],
              ["黑白名单维护", "未来接受控名单命令，不让名单变更绕过审批。"],
              ["风险标签处置", "对账户打标、解除标记和策略豁免进行审计留痕。"],
            ].map(([title, description]) => (
              <Box key={title} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Heading size="sm">{title}</Heading>
                <Text mt="8px" color="ink.500">{description}</Text>
              </Box>
            ))}
          </Stack>
        </SurfaceCard>

        <SurfaceCard eyebrow="Risk Approval Queue" title="风险相关审批" description="把高风险充值、大额提现和异常资金动作统一拉平，reviewer 从 dashboard 跳进来后就能直接定位。" stamp={`${visibleRiskItems.length}/${riskItems.length} items`}>
          <Grid templateColumns={{ base: "1fr", xl: "minmax(0, 320px) 180px" }} gap="12px" mb="16px">
            <SearchInput value={search} onChange={setSearch} placeholder="搜索审批号 / 类型 / 发起角色" />
            <select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)} style={nativeFieldStyle}>
              <option value="all">全部等级</option>
              <option value="L3">L3</option>
              <option value="L2">L2</option>
              <option value="L1">L1</option>
            </select>
          </Grid>
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
                <Box as="tr" key={item.approvalId}>
                  <Td>
                    <Text fontWeight="700">{item.approvalId}</Text>
                    <Text color="ink.500">{item.requesterRole}</Text>
                  </Td>
                  <Td>
                    <Text>{getApprovalTypeLabel(item.approvalType)}</Text>
                    <Text color="ink.500">{item.approvalType}</Text>
                  </Td>
                  <Td><SentinelStatusChip label={item.approvalLevel} tone={riskLevelTone(item.approvalLevel)} /></Td>
                  <Td><SentinelStatusChip label={getApprovalStatusLabel(item.status)} tone={riskStatusTone(item.status)} /></Td>
                  <Td>{formatDateTime(item.createdAt)}</Td>
                </Box>
              ))}
            </TableBody>
          </DataTable>
        </SurfaceCard>
      </Grid>
    </AdminShell>
  );
}