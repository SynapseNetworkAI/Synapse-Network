"use client";

import { Box, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { DataTable, MessageBanner, MetricCard, SearchInput, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th, nativeFieldStyle } from "@/components/console-ui";
import { formatDateTime, inputText } from "@/lib/admin-console";
import { buildAuditMetrics, collectAuditStatuses, filterAuditItems, sortAuditItems, topAuditErrorCodes } from "@/features/audit/audit-presenters";
import { useAdminSession } from "@/lib/use-admin-session";
import { listAuditActions, type AuditActionItem } from "@/services/admin-api";

export default function AuditPage() {
  const { admin, token, loading } = useAdminSession();
  const [items, setItems] = useState<AuditActionItem[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const visibleItems = useMemo(() => sortAuditItems(filterAuditItems(items, deferredSearch, statusFilter)), [deferredSearch, items, statusFilter]);
  const metrics = useMemo(() => buildAuditMetrics(items), [items]);
  const statuses = useMemo(() => collectAuditStatuses(items), [items]);
  const errorCodes = useMemo(() => topAuditErrorCodes(items), [items]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    async function load() {
      try {
        const response = await listAuditActions(activeToken, { limit: 100 });
        if (!cancelled) {
          setItems(response.items);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载审计日志失败");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || !admin) {
    return <main className="state-screen">正在检索审计链路...</main>;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Audit & Compliance"
      title="操作日志与审计追踪"
      description="关键资金动作、后台用户变更和审批决策统一落审计，避免控制面成为黑盒。"
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}

      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label="Audit events" value={metrics.total} meta="immutable operator trail rows" />
        <MetricCard label="Failures" value={metrics.failed} meta="events with non-success result" />
        <MetricCard label="Approval-linked" value={metrics.approvalLinked} meta="events tied to approval decisions" />
        <MetricCard label="Execution-linked" value={metrics.executionLinked} meta="events tied to job execution" />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1.08fr 0.92fr" }} gap="16px">
        <SurfaceCard eyebrow="Audit Ledger" title="Immutable operator trail" description="所有审批决定、任务重试、配置发布和高风险动作都应在这里可追踪。" stamp={`${visibleItems.length}/${items.length} events`}>
          <Grid templateColumns={{ base: "1fr", xl: "minmax(0, 320px) 180px" }} gap="12px" mb="16px">
            <SearchInput value={search} onChange={setSearch} placeholder="搜索 operator / resource / approval / job" />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={nativeFieldStyle}>
              <option value="all">全部结果</option>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </Grid>
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
              {visibleItems.map((item, index) => (
                <Box as="tr" key={`${item.auditId ?? index}-${item.actionType}`}>
                  <Td>
                    <Text fontWeight="700">{item.actionType}</Text>
                    <Text color="ink.500">audit #{item.auditId ?? "n/a"}</Text>
                  </Td>
                  <Td><SentinelStatusChip label={item.resultStatus} tone={item.resultStatus === "success" ? "green" : "red"} /></Td>
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
              ))}
            </TableBody>
          </DataTable>
        </SurfaceCard>

        <Stack gap="16px">
          <SurfaceCard eyebrow="Guardrail" title="Why this page matters" description="没有完整审计链路的管理后台，迟早会在提现、退款和配置发布上出事故。">
            <Stack gap="12px">
              {[
                "审批人与执行人分离必须在审计链中可被证明。",
                "重试 execution job 必须留下 reviewer note 与 OTP 保护痕迹。",
                "配置中心的 draft / published 切换需要形成完整的 operator trail。",
              ].map((item) => (
                <Box key={item} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                  <Text>{item}</Text>
                </Box>
              ))}
            </Stack>
          </SurfaceCard>

          <SurfaceCard eyebrow="Error Clusters" title="高频错误码" description="先看聚集错误，再决定是 reviewer 误操作、权限配置问题，还是执行链路本身在退化。">
            <Stack gap="12px">
              {errorCodes.length === 0 ? (
                <Box borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                  <Text color="ink.500">当前窗口内没有聚集错误码，说明控制面的失败主要不是由同一类错误重复引起。</Text>
                </Box>
              ) : errorCodes.map((item) => (
                <Box key={item.errorCode} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                  <Heading size="sm">{item.errorCode}</Heading>
                  <Text mt="8px" color="ink.500">{item.count} events in current window</Text>
                </Box>
              ))}
            </Stack>
          </SurfaceCard>
        </Stack>
      </Grid>
    </AdminShell>
  );
}